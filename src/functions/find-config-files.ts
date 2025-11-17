import * as path from 'path';
import * as fs from 'fs';
export function findConfigFiles(root: string): string[] {
  const candidates = [
    'package.json', 'tsconfig.json', 'jsconfig.json',
    'pyproject.toml', 'requirements.txt', 'Cargo.toml',
    'go.mod', 'pom.xml', 'build.gradle'
  ];
  return candidates
    .map(name => path.join(root, name))
    .filter(fs.existsSync);
}