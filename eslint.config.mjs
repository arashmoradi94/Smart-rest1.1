import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dependencies and generated code are never linted:
    "node_modules/**",
    "src/generated/**",
    // Local scratch / QA artifacts (browser profile dumps, temp scripts):
    "tmp-qa/**",
  ]),
]);

export default eslintConfig;
