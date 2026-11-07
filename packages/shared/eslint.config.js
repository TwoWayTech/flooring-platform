import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["fixtures/**", "coverage/**"] }, ...tseslint.configs.recommended);
