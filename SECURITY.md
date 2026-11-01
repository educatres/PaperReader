# PaperReader security

PaperReader treats extracted PDF text, imported project content, and note text as untrusted research data. Before any AI provider request, the app locally checks the combined task and source text for common prompt injection attempts, including:

- overriding or bypassing previous instructions;
- changing the assistant's identity or role;
- requesting the system/developer prompt or internal rules; and
- asking the model to execute tools, functions, or commands.

When a match is found, the request is stopped before a network call, no AI result is saved, and the app shows a warning without echoing the untrusted text. The provider request also includes a fixed guard that treats source text as data and forbids identity changes, prompt disclosure, and tool execution. Responses that appear to disclose protected prompt text are discarded.

These checks are deterministic heuristics. They reduce common injection paths but cannot prove arbitrary content is safe. Keep API keys in the session-only settings field and review source text before sending it to an external provider.
