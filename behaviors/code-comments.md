## Comments and docstrings: functional, not forensic

Write commentary that states what a reader cannot infer from the code itself — the contract, the invariant, the unit, the constraint that still governs the code today. Cut everything else.

- **No debugging war-stories.** Don't narrate the investigation that produced the line ("we tried X, but under load Y happened, so now we…"). That history belongs in the commit message, the PR, or an ADR — not inline, where it rots and buries the signal. A comment describes the code as it is now, in the present tense, not how it got here or why a past attempt failed.
- **No restating the code.** `// increment i` over `i++` is noise. If a name or structure makes a comment redundant, fix the name and delete the comment. Self-documenting code beats a comment that re-narrates it.
- **Bullets over dense paragraphs.** When a comment or docstring runs past one sentence, format it as a short scannable list, not a multi-line block of prose — several short lines read faster than a wall of text. Docstrings likewise use fields (params, returns, raises) rather than burying them in a paragraph.
- **Do document** the genuinely non-obvious: why a bound exists ("API caps at 100 per page"), units and ranges, ordering or concurrency assumptions, an edge case that looks like a bug, why the tempting simpler approach is wrong, and anything a caller must not violate.
- **Docstrings describe the contract, not the implementation:** what it does, parameters, return, what it raises, units. Public API earns a docstring; trivial internals usually don't. Match prose density to the surrounding code — terse modules get terse docs.
- **Comments are load-bearing claims.** When you change the code, update or delete the comments that referenced the old shape. A stale comment is worse than no comment.

Default to fewer, sharper comments. If you can't say why a line of commentary earns its place, cut it.

_Grounding: PEP 257, Google style guides, and the "why, not what" lineage — sharpened so "why" means the constraint that still binds the code, not the story of how it was written._
