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
  const { message, email, orderId, pageUrl, screenshot } = req.body;

  if (!message || !email || !orderId) {
    return res.status(400).json({ error: "message, email, and orderId are required." });
  }

  const systemPrompt = `You are a fraud risk analyst for an e-commerce platform powered by Yofi.
Given a customer's email, order ID, page context, and analyst notes, you assess fraud risk.

ALWAYS respond with valid JSON in this exact shape:
{
  "score": <integer 0-100>,
  "explanation": "<2-3 sentence plain-English summary of the risk assessment and key signals>"
}

Score guide:
- 0-34: Low risk — approve
- 35-59: Medium risk — flag for review
- 60-79: High risk — hold and verify
- 80-100: Critical risk — block

Be realistic and specific. Reference the email, order ID, and any page context provided.`;

  const userContent = [
    {
      type: "text",
      text: `Customer Email: ${email}\nOrder ID: ${orderId}\nPage URL: ${pageUrl || "unknown"}\nAnalyst note: ${message}`,
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
      model:      "claude-3-5-haiku-20241022",
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
