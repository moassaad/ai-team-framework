/**
 * Type shim for the `yaml` package.
 *
 * `yaml` v2 exposes its bundled declarations only through the
 * `exports["."].types` condition, which TypeScript honors solely under
 * `node16`/`nodenext` module resolution. This project intentionally stays
 * on `moduleResolution: "Node"` (CommonJS, F-002), so the bare import
 * would otherwise resolve as implicitly `any` and fail the build.
 * This shim gives the import a module identity; `loader.ts` immediately
 * narrows the parse result to `unknown`, so no untyped value escapes.
 */
declare module "yaml";
