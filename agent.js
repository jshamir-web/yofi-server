const { ChatAnthropic }      = require("@langchain/anthropic");
const { tool }               = require("@langchain/core/tools");
const { createReactAgent }   = require("langchain/agents");
const { AgentExecutor }      = require("langchain/agents");
const { z }                  = require("zod");
const axios                  = require("axios");
const cheerio                = require("cheerio");

// ── Yofi docs pages to index ─────────────────────────────────────────────────
const DOCS_BASE = "https://docs.yofi.ai";

// ── Tool: fetch and parse a docs page ────────────────────────────────────────
const fetchDocsTool = tool(
  async ({ url }) => {
    try {
      // Resolve relative URLs
      const fullUrl = url.startsWith("http") ? url : `${DOCS_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
      const res     = await axios.get(fullUrl, { timeout: 10000, headers: { "User-Agent": "YofiAgent/1.0" } });
      const $       = cheerio.load(res.data);

      // Remove nav, scripts, styles
      $("script, style, nav, footer, header, .sidebar, .nav, [role='navigation']").remove();

      // Extract main content
      const main = $("main, article, .content, .docs-content, [role='main']").first();
      const text = (main.length ? main : $("body")).text()
        .replace(/\s{3,}/g, "\n\n")
        .replace(/\n{4,}/g, "\n\n")
        .trim()
        .slice(0, 8000); // cap at 8k chars

      return text || "No content found at this URL.";
    } catch (err) {
      return `Error fetching ${url}: ${err.message}`;
    }
  },
  {
    name: "fetch_yofi_docs",
    description: `Fetch and read a page from the Yofi documentation site (docs.yofi.ai).
Use this to look up specific topics, API details, integration guides, or any Yofi feature.
Pass a full URL like "https://docs.yofi.ai/yofi-on-enterprise/integrate-with-yofi/sending-data-to-yofi"
or a relative path like "/getting-started".`,
    schema: z.object({
      url: z.string().describe("The full or relative URL of the Yofi docs page to fetch"),
    }),
  }
);

// ── Tool: list top-level docs sections ───────────────────────────────────────
const listDocsSectionsTool = tool(
  async () => {
    try {
      const res = await axios.get(DOCS_BASE, { timeout: 10000, headers: { "User-Agent": "YofiAgent/1.0" } });
      const $   = cheerio.load(res.data);
      const links = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && href.includes("yofi") && text && text.length > 2 && text.length < 80) {
          const full = href.startsWith("http") ? href : `${DOCS_BASE}${href}`;
          if (!links.find(l => l.url === full)) links.push({ text, url: full });
        }
      });
      return links.slice(0, 30).map(l => `${l.text}: ${l.url}`).join("\n") || "Could not list docs sections.";
    } catch (err) {
      return `Error listing docs: ${err.message}`;
    }
  },
  {
    name: "list_yofi_docs_sections",
    description: "List the top-level sections and pages available in the Yofi documentation. Use this first to discover what topics are available before fetching a specific page.",
    schema: z.object({}),
  }
);

// ── Build the agent ───────────────────────────────────────────────────────────
let agentExecutor = null;

async function getAgent() {
  if (agentExecutor) return agentExecutor;

  const llm = new ChatAnthropic({
    apiKey:      process.env.ANTHROPIC_API_KEY,
    model:       "claude-sonnet-4-5",
    temperature: 0.2,
  });

  const tools = [listDocsSectionsTool, fetchDocsTool];

  const agent = await createReactAgent({ llm, tools });

  agentExecutor = new AgentExecutor({
    agent,
    tools,
    maxIterations:  8,
    returnIntermediateSteps: false,
    verbose: false,
  });

  return agentExecutor;
}

// ── Run a query through the agent ─────────────────────────────────────────────
async function runAgent(userMessage) {
  const executor = await getAgent();

  const systemContext = `You are a Yofi expert assistant. Yofi is a fraud prevention and risk intelligence platform for e-commerce.

Your job is to:
1. Answer questions about how Yofi works, its APIs, integrations, and features
2. Provide specific guidance and recommendations based on the official Yofi documentation
3. Help users understand risk scores, predictions, signals, and segments
4. Give actionable advice on integrating with Yofi

Always use the documentation tools to look up accurate, up-to-date information before answering.
Be specific, practical, and reference the actual docs when possible.`;

  const result = await executor.invoke({
    input: `${systemContext}\n\nUser question: ${userMessage}`,
  });

  return result.output;
}

module.exports = { runAgent };
