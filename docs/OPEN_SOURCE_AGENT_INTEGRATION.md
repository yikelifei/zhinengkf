# Open Source Agent Integration

This project embeds a lightweight customer-support Agentic RAG workflow inspired by:

- Repository: https://github.com/amine-akrout/customer-support-agentic-rag
- Pattern used: question validation, topic classification, document retrieval, document grading, answer generation, and answer validation.

The external repository was not vendored into this codebase. The current implementation is a local, dependency-light workflow tailored to the existing WeChat automation runtime:

- `core/customer_agent.py`
- `config/customer_knowledge.yaml`
- `config/prompts.yaml`

Reasoning:

- The current product is a desktop WeChat automation bot, not a web RAG service.
- Pulling a full LangGraph/LangChain/FAISS stack into the runtime would increase installation and packaging risk.
- The embedded implementation keeps the useful support-agent architecture while preserving the existing executable delivery model.

Commercial use note:

- No source code from the external repository is copied here.
- The integration is an independently implemented workflow based on the public architecture pattern.
- Keep this file with the project so future maintainers know what was integrated and why.
