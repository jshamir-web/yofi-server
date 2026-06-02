require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app    = express();
const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "20mb" })); // screenshots can be large

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", service: "Yofi Risk Server" }));

// ── Risk assessment endpoint ───────────────────────────────────────────────────
app.post("/assess", async (req, res) => {
  const { message, email, orderId, pageUrl, screenshot, fields = {} } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required." });
  }

  const systemPrompt = `You are a fraud risk analyst for an e-commerce platform powered by Yofi.
You are given automatically extracted customer data from a live page, a screenshot, and analyst notes.
Assess the fraud risk based on all available signals.

ALWAYS respond with valid JSON in this exact shape:
{
  "score": <integer 0-100>,
  "explanation": "<2-4 sentence plain-English summary covering the key risk signals found, what's suspicious or safe, and a recommendation>"
}

Score guide:
- 0-34: Low risk — approve
- 35-59: Medium risk — flag for review
- 60-79: High risk — hold and verify
- 80-100: Critical risk — block

Be specific — reference the actual email, order ID, amount, IP, or any other signals you see.`;

  // Build a rich context string from all scraped fields
  const fieldLines = Object.entries(fields)
    .filter(([k]) => !["pageTitle","pageUrl"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const userContent = [
    {
      type: "text",
      text: [
        fieldLines ? `--- Detected on page ---\n${fieldLines}` : "",
        email   ? `Email: ${email}`     : "",
        orderId ? `Order ID: ${orderId}` : "",
        pageUrl ? `Page URL: ${pageUrl}` : "",
        fields.pageTitle ? `Page Title: ${fields.pageTitle}` : "",
        `\n--- Analyst note ---\n${message}`,
      ].filter(Boolean).join("\n"),
    },
    ...(screenshot ? [{
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: screenshot.replace("data:image/png;base64,", ""),
      },
    }] : []),
  ];

  try {
    const response = await client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userContent }],
    });

    const raw     = response.content?.[0]?.text || "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);

    res.json({
      score:       Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      explanation: parsed.explanation || raw,
    });
  } catch (err) {
    console.error("Claude error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Yofi server running on port ${PORT}`));
