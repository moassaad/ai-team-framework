# AI Team Framework

A reusable, project-agnostic AI team framework for software development.

It coordinates specialized AI roles to help analyze, plan, implement, review, and track work across new and existing software projects.

## AI Team

* **Coordinator** — user-facing coordination
* **Project Manager** — requirements and project planning
* **Technical Lead** — project analysis and technical planning
* **Implementer** — focused implementation
* **Senior Reviewer** — implementation and quality review

## Role Selection

Roles can be selected through:

* CLI commands
* Natural-language prompts
* Optional slash commands

Example:

```text
/technical-lead
```

or:

```bash
ai-team run --role technical-lead
```

## Project Support

The framework is designed to work with different technology stacks.

It does not impose a specific architecture or development pattern on the target project.

Before implementation, the team discovers and analyzes the existing project.

## Integrations

The framework is designed to support:

* OpenCode
* Spec Kit
* GitHub Issues
* delegate-skills (optional)

Optional integrations must not be required for the core framework to work.

## Project Workspace

Framework-specific configuration and state are isolated under:

```text
.ai-team/
```

## Status

M0 — Discovery and Specification is complete.

M1 — Repository Foundation is starting. No framework functionality is implemented yet.

Target release:

```text
0.1.0
```

## License

MIT
