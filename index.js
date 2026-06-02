require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app    = express();
const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => res.json({ status: "ok", service: "Yofi Risk Server" }));

app.post("/assess", async (req, res) => {
  const { message, email, orderId, pageUrl, screenshot, fields = {} } = req.body;
  if (!message) return res.status(400).json({ error: "message is required." });

  const systemPrompt = `You are a fraud risk analyst AI for Yofi, an e-commerce fraud prevention platform.
Analyze the provided customer data and return a fraud risk assessment in this EXACT JSON format (no markdown, no extra text):

{
  "id": "cust_<8 random hex chars>",
  "originalCustomerId": "<use orderId or email prefix if available, else 'unknown'>",
  "appId": "<domain from pageUrl or 'unknown.myshopify.com'>",
  "organizationId": "4f3d2e1a-8c9b-4a5d-9e7f-1234567890ab",
  "tags": ["<relevant_tag>"],
  "predictions": [
    {
      "id": "pred_<6 random hex>",
      "predictedScore": <float 0.0-1.0>,
      "predictedLabel": "<chargeback_risk|fraud|policy_abuse|friendly_fraud>",
      "severity": "<low|medium|high|critical>",
      "predictedAt": "<ISO timestamp>",
      "justification": "<1 sentence explaining the top risk reason>",
      "signals": [
        {
          "key": "<snake_case_signal_key>",
          "title": "<Short Signal Title>",
          "description": "<What this signal means for this customer>",
          "category": "<history|identity|behavior|device|velocity>",
          "severity": "<low|medium|high|critical>",
          "impactScore": <float 0.0-0.5>,
          "value": "<observed value>",
          "valueType": "<string|integer|float|boolean>"
        }
      ]
    }
  ],
  "segments": [
    {
      "segmentId": "seg_<8 random hex>",
      "code": "<UPPER_SNAKE_CASE_CODE>",
      "name": "<Human Readable Segment Name>",
      "segmentType": "<persona|behavioral|risk>",
      "source": "ml_derived",
      "assignedAt": "<ISO timestamp>"
    }
  ],
  "analytics": [
    {
      "id": "analytic_<8 random hex>",
      "entityId": "<same as id above>",
      "entityType": "customer",
      "metricName": "<snake_case_metric>",
      "metricValue": "<string value>",
      "metricValueNumeric": <numeric value>,
      "valueType": "<float|integer|percentage>",
      "period": "<lifetime|90d|30d|7d>"
    }
  ],
  "documents": []
}

Generate 1-3 predictions, 2-5 signals, 1-2 segments, and 2-3 analytics metrics.
Base everything on the real signals in the data provided. Be specific and realistic.`;

  const fieldLines = Object.entries(fields)
    .filter(([k]) => !["pageTitle","pageUrl"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const userContent = [
    {
      type: "text",
      text: [
        fieldLines         ? `--- Detected on page ---\n${fieldLines}` : "",
        email              ? `Email: ${email}`          : "",
        orderId            ? `Order ID: ${orderId}`     : "",
        pageUrl            ? `Page URL: ${pageUrl}`     : "",
        fields.pageTitle   ? `Page Title: ${fields.pageTitle}` : "",
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
      max_tokens: 1500,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userContent }],
    });

    const raw     = response.content?.[0]?.text || "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Yofi server running on port ${PORT}`));
