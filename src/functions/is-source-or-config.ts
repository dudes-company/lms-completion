import * as path from "path";
import { configsExt, langsExt } from "../file-extensions";
export const isSourceOrConfig = (name: string) => {
  const ext = path.extname(name).toLowerCase();
  return configsExt.includes(ext) || [
    'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml'
  ].includes(name);
};