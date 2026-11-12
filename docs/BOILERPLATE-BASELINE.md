# Baseline inspection

The provided repository is the common-core skeleton described by the guide.
It contains no PostgreSQL/Drizzle, Valkey, domain queue or actual persistent error
store: those are optional feature blocks explicitly excluded by its README.
The repository is therefore required, but copying it does not migrate Mention.

Its current core also differs from the live guide: the starter rate limiter uses
memory and enables proxy trust, while the guide requires a shared store and careful
proxy identity. Do not copy those assumptions into the existing local/public
permission model. The current task does not enable a rate limiter in production.

Security audit input: the unchanged supplied pnpm-lock.yaml. Private full output:
`.dev/tmp/boilerplate-audit.json`. This output contains dependency metadata only.
The audit reports80unique advisories, including4critical and36high; dependency-path
counts in metadata can differ from unique advisory counts. Critical affected
packages include transitive build/test tools (`@xhmikosr/decompress`, `piscina`,
`tinypool`), not a claim of a proven exploitable production path. Direct version
families also need review, including Vite, Router, Fastify/static and Zod.

The user authorized security-fixed versions. Updated NestJS11 within its major,
Fastify5, Router7, Vite8, Zod4, Vitest4 and compatible build plugins. Approved
major changes are security-driven, not arbitrary replacements of the company
architecture. The lockfile records exact resolved versions and scoped transitive
overrides. Node24.14.0 and pnpm9.15.9 were used for verification.

`pnpm verify` passed after the security update: lint, build, core unit and API e2e.
Production audit has zero reported advisories. Full development-tree audit retains
one low-severity `deepmerge` advisory through Nest CLI's webpack type checker, with
no published patched version. It is not silently suppressed. Do not load untrusted
build configurations; no production runtime dependency has been reported affected.
Reports are private under `.dev/tmp/`. Docker validation remains unavailable.
