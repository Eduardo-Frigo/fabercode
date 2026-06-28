# Faber Code

Faber Code is an advanced, local-first Spec-Driven Development (SDD) IDE powered by AI. It empowers developers to create, edit, run, version, and deploy software projects directly from their local machine, ensuring the user remains entirely in control of their files, repositories, and final decisions.

Faber Code is distributed under the Apache-2.0 License.

## Core Features

Faber Code is built around the concept of **Spec-Driven Development (SDD)**, fundamentally changing how applications are planned and built through visual and AI-assisted workflows.

### Application Map & Spec-Driven Development
Every project has its own Application Map. Users can visually map out their application by organizing texts, inserting images, and connecting concepts in a mind-map structure. 
- **Map Chat:** Users can interact with an AI directly on the map. The AI analyzes the organized information, answers questions based on the input, and helps refine missing parts of the development scope.
- **Auto-Documentation:** All text generated and refined in the map is automatically saved as Markdown files in the project folder, keeping images and documentation perfectly organized.

### Milestone Rendering
Once the Application Map is complete, the user can "Render" the map. A dedicated AI process reviews the mapped information and translates it into an actionable development plan broken down into **Milestones**. This simplifies the dialogue with the development AI and ensures the project follows a clear path.

### Development Chat
The Development Chat is context-aware and deeply integrated with your planning. 
- Users can jump straight into the Development Chat to start coding immediately.
- If the project was planned using the Application Map and rendered into Milestones, the Development Chat uses this context. When the user decides to work on "Milestone 1", the AI automatically briefs the development plan by reading the associated Markdown files and organized assets from that specific project phase.

### Multi-API AI Support
Faber Code's AI actions are fully flexible and depend on the API connected by the user. Supported integrations include:
- OpenAI
- Google Gemini
- Anthropic Claude
- DeepSeek
- Local AIs (via compatible endpoints)

## Additional Tools & Capabilities

Beyond its advanced development and planning features, Faber Code functions as a complete IDE:

- **Custom File Tree:** A proprietary, highly optimized file explorer built directly into the workspace.
- **Visual Git Tool:** A comprehensive visual panel that makes versioning, staging, committing, and deploying straightforward, without requiring manual terminal commands or AI intervention.
- **Integrated Terminal:** A custom-built terminal for executing commands within the project's context.
- **Application Executor:** A built-in runner that seamlessly launches the application in the user's main browser, handling local runtimes and port management automatically.

## Installation & Setup

Requirements:
- Node.js (compatible with `package.json`)
- npm
- Git
- Electron-compatible desktop environment

```bash
npm install
cp .env.example .env
npm run dev
```

*Note: Only `.env.example` should be committed to Git. Never publish your `.env`, API keys, tokens, local databases, private memories, or client projects.*

## Security and Privacy

Faber Code is designed with a local-first philosophy to prevent accidental leaks of private information:
- `.env` and local variants are ignored by Git.
- Local models, databases, caches, memories, artifacts, and generated projects are not versioned.
- External integrations are strictly opt-in and configured entirely by the user.

Please read [SECURITY.md](SECURITY.md) before publishing a fork or release.

## License and Trademarks

The source code is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The name Faber Code, logos, icons, and brand assets identify the official project. The Apache-2.0 license does not grant trademark rights or use that implies official endorsement, distribution, or affiliation without permission.
