# Latzerus MCP Server

[![smithery badge](https://smithery.ai/badge/cllatzi/latzerus-mcp)](https://smithery.ai/servers/cllatzi/latzerus-mcp)

The **Latzerus MCP Server** acts as an intelligent interface to the comprehensive Swiss knowledge base [latzerus.ch](https://www.latzerus.ch) for B2B sales and the practical application of artificial intelligence in everyday work. True to the principle of "Smart, not hard," the server provides immediately actionable solutions and measurable time savings directly within your AI assistant.

The server operates via a **Streamable HTTP endpoint**. It is completely free, open, and requires no account or API key.

## 🛠 Features & Tools
This server provides AI assistants (like Claude, ChatGPT, Cursor, etc.) with four read-only tools to access over 100 field-tested 5-minute learning modules:

* **`lernmodule_suchen`**: Searches all modules by keywords and returns the title, topic, URL, and a short description.
* **`lernmodul_lesen`**: Retrieves a specific module in full text, including key points, practical steps, common mistakes, and FAQs.
* **`lernmodule_uebersicht`**: Lists all available modules, neatly grouped by the four main themes (Sales & Communication, AI in everyday work, Career, Wild Topics).
* **`ueber_latzerus`**: Provides background information about the project, Christoph Latzer, the topics, and contact details.

## 🎯 Primary Use Cases
* **Sales & Cold Calling:** Get concrete argumentation frameworks, strategies for handling objections (e.g., "too expensive"), and closing tactics on demand.
* **AI & Compliance:** Access data protection-compliant recommendations (DSGVO/DSG) and setup assistance for both cloud AI and local models (Ollama, Mistral).
* **Career Positioning:** Honest, buzzword-free guidance for professional assessments and impactful job applications.

## 🚀 Getting Started

The server uses standard Streamable HTTP (`https://mcp.latzerus.ch/mcp`). Here is how you can connect it to popular clients:

### Claude Desktop
1. Open Settings -> **Connectors**.
2. Click **Add custom connector**.
3. Name: `Latzerus`
4. URL: `https://mcp.latzerus.ch/mcp`
5. Save (Leave OAuth Client ID and Secret empty).

### Cursor (or VS Code)
Create or edit your `mcp.json` file (e.g., `.cursor/mcp.json` or `.vscode/mcp.json`):
```json
{
  "mcpServers": {
    "latzerus": {
      "url": "[https://mcp.latzerus.ch/mcp](https://mcp.latzerus.ch/mcp)"
    }
  }
}
```
*(Note: For VS Code use `"servers"` instead of `"mcpServers"` and add `"type": "http"`).*

For instructions on other clients like ChatGPT, Open WebUI, AnythingLLM, or LM Studio, please visit the [official Latzerus MCP Setup Guide](https://www.latzerus.ch/mcp/).

## 📜 License & Usage
Reading, citing, and summarizing the content is highly encouraged. Please attribute the source as: `"Christoph Latzer, Latzerus — https://www.latzerus.ch/"`.
No tracking cookies are used. The server is strictly read-only and cannot alter any data on your machine.
