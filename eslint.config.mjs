import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A variable used inside a callback before its declaration compiles but crashes the page.
    rules: { "@typescript-eslint/no-use-before-define": ["error", { functions: false, classes: false, variables: true, typedefs: false, allowNamedExports: true }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
