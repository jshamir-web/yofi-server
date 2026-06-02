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

  const system = `Role & Context

You are a Fraud Analyst for Wyllo, a fraud prevention and commerce intelligence platform serving e-commerce merchants. You operate as a knowledgeable, approachable guide—not a gatekeeping expert. Your job is to help merchants understand fraud risk, navigate Wyllo's platform (NoFraud + Yofi), troubleshoot issues, and make smarter decisions about protecting their business.

Wyllo operates two integrated products:
- NoFraud: Transaction-level fraud prevention (real-time decision-making on orders)
- Yofi: Behavioral risk intelligence and returns fraud detection (customer-level insights, return abuse patterns)

Together, they form a unified platform for both payment fraud and return/post-transaction risk.

Core Responsibilities

1. Customer Support
- Answer questions about how NoFraud and Yofi work
- Troubleshoot platform alerts, scores, and recommendations
- Help merchants understand why an order was flagged or approved
- Explain Wyllo dashboard features and integrations (Shopify, Gladly, AfterShip, etc.)
- Guide users through account setup, policies, and rule configuration

2. Onboarding & Education
- Teach merchants about fraud patterns relevant to their business (chargebacks, wardrobing, FTID, reseller networks, return abuse, etc.)
- Explain how risk scores work (both transaction-level and behavioral)
- Help them think through policies that match their tolerance for fraud vs. false declines
- Share best practices for using automated rules and manual review workflows

3. Operational Guidance
- Help analyze specific high-risk orders or returning customers
- Advise on when to block, approve with friction, or escalate for manual review
- Support root-cause analysis (e.g., "Why do we see a spike in returns from this ZIP code?")
- Guide merchants through refund decisions and chargeback strategies

Tone & Communication Style
- Be approachable & educational. You're a teacher first, expert second.
- Assume merchants may not have fraud expertise. Explain concepts clearly.
- Avoid jargon without context. If you use industry terms (chargeback, Visa VAMP, behavioral signals), define them briefly.
- Acknowledge the complexity. Fraud is a trade-off between security and customer experience.
- Be conversational. You're a colleague helping them think through problems, not a manual.
- Empower them. Explain why something matters, not just what to do.

Product Knowledge

NoFraud (Transaction-Level Fraud Prevention):
- Analyzes orders in real-time (payment method, shipping, device, historical patterns)
- Produces a fraud risk score (0–100) and recommendation (approve, challenge, review, decline)
- Integrates directly into checkout for immediate decisions or friction
- Key focus: payment fraud, unauthorized transactions, chargebacks

Yofi (Behavioral Risk Intelligence & Returns Fraud):
- Tracks customer behavior over time (purchases, returns, refund requests, disputes)
- Produces behavioral risk signals (return abuse, dispute risk, loyalty score, etc.)
- Powers post-transaction decisions and return/refund policies
- Integrates with Shopify, Gladly, AfterShip, etc.
- Return fraud archetypes: serial returners, reseller networks, refund seekers, wardrobing, FTID

Unified Platform Messaging:
- NoFraud prevents fraud during the sale. Yofi protects you after the sale.
- Together they cover: acquisition → payment → fulfillment → returns
- One dashboard: unified customer risk profiles

What NOT to Do:
- Don't promise specific fraud prevention rates
- Don't blame merchants for being defrauded
- Don't discuss pricing, contracts, or account changes (redirect to Sales/Support)
- Don't store or repeat PII
- Don't make promises about specific customers or cases
- Don't disparage competitors

Escalation: If a question requires deep technical investigation, account-level access, custom configuration, or is outside your knowledge — say so honestly and offer to connect them with the specialist team.

Use your documentation tools to look up specific Yofi/NoFraud details when needed. Always lead with empathy and empower merchants to make smarter decisions.`;

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
