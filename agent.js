const Anthropic = require("@anthropic-ai/sdk");
const axios     = require("axios");
const cheerio   = require("cheerio");

const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const DOCS_BASE = "https://docs.yofi.ai";

// ── Tools definition (Anthropic tool_use format) ──────────────────────────────
const TOOLS = [
  {
    name: "list_yofi_docs_sections",
    description: "List the top-level sections and links available in the Yofi documentation. Use this first to discover what pages exist.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "fetch_yofi_docs",
    description: "Fetch and read a specific page from the Yofi documentation site. Use this to get detailed information about a topic.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL or relative path of the Yofi docs page, e.g. https://docs.yofi.ai/getting-started or /integrate-with-yofi",
        },
      },
      required: ["url"],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────────
async function listDocsSections() {
  try {
    const res = await axios.get(DOCS_BASE, { timeout: 8000, headers: { "User-Agent": "YofiAgent/1.0" } });
    const $   = cheerio.load(res.data);
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (href && text && text.length > 2 && text.length < 80) {
        const full = href.startsWith("http") ? href : `${DOCS_BASE}${href.startsWith("/") ? "" : "/"}${href}`;
        if (full.includes("yofi") && !links.find(l => l.url === full)) {
          links.push({ text, url: full });
        }
      }
    });
    if (!links.length) return "Could not list sections — try fetching a specific page directly.";
    return links.slice(0, 25).map(l => `${l.text}: ${l.url}`).join("\n");
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

async function fetchDocsPage(url) {
  try {
    const fullUrl = url.startsWith("http") ? url : `${DOCS_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
    const res     = await axios.get(fullUrl, { timeout: 8000, headers: { "User-Agent": "YofiAgent/1.0" } });
    const $       = cheerio.load(res.data);
    $("script, style, nav, footer, header, .sidebar, [role='navigation']").remove();
    const main = $("main, article, .content, .docs-content, [role='main']").first();
    const text = (main.length ? main : $("body")).text()
      .replace(/\s{3,}/g, "\n\n")
      .replace(/\n{4,}/g, "\n\n")
      .trim()
      .slice(0, 6000);
    return text || "No readable content found at this URL.";
  } catch (err) {
    return `Error fetching ${url}: ${err.message}`;
  }
}

async function runTool(name, input) {
  if (name === "list_yofi_docs_sections") return await listDocsSections();
  if (name === "fetch_yofi_docs")         return await fetchDocsPage(input.url);
  return "Unknown tool.";
}

// ── Agentic loop ──────────────────────────────────────────────────────────────
async function runAgent(userMessage, history = []) {
  // Build messages array with prior conversation history
  const messages = [
    // Inject history as alternating user/assistant turns
    ...history.map(h => ({ role: h.role, content: h.content })),
    // Current message
    { role: "user", content: userMessage },
  ];

  const system = `You are a Yofi expert assistant. Yofi is a fraud prevention and risk intelligence platform for e-commerce.

Your job is to give accurate, specific guidance based on the official Yofi documentation.
Always use your tools to look up the docs before answering — do not guess.
Be practical and actionable. Reference specific pages or sections when relevant.`;

  // Agentic loop — max 5 iterations
  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: 1024,
      system,
      tools:      TOOLS,
      messages,
    });

    // Append assistant response to history
    messages.push({ role: "assistant", content: response.content });

    // If Claude is done, return the final text
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(b => b.type === "text");
      return textBlock?.text || "I wasn't able to find a clear answer in the Yofi docs.";
    }

    // If Claude wants to use tools, run them and feed results back
    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await runTool(block.name, block.input);
          toolResults.push({
            type:        "tool_result",
            tool_use_id: block.id,
            content:     result,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  return "I reached the maximum number of steps. Please try a more specific question.";
}

module.exports = { runAgent };
