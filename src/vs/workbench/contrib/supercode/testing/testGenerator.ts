/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

// ============================================================================
// TYPES
// ============================================================================

export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'pytest' | 'unittest' | 'unknown';

export interface TestCase {
    name: string;
    description: string;
    code: string;
    isAsync: boolean;
}

export interface TestSuite {
    framework: TestFramework;
    imports: string[];
    setupCode: string;
    testCases: TestCase[];
    teardownCode: string;
}

export interface GeneratedTest {
    filePath: string;
    content: string;
    framework: TestFramework;
}

export interface FunctionSignature {
    name: string;
    params: string[];
    returnType: string;
    isAsync: boolean;
    body: string;
}

// ============================================================================
// TEST GENERATOR SERVICE
// ============================================================================

export class TestGeneratorService {
    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService
    ) {
        this.logService.info('[TestGenerator] Service initialized');
    }

    /**
     * Detect test framework from package.json or pyproject.toml
     */
    public async detectFramework(workspaceRoot: URI): Promise<TestFramework> {
        try {
            // Check package.json
            const packageJsonUri = URI.joinPath(workspaceRoot, 'package.json');
            const packageJsonBuffer = await this.fileService.readFile(packageJsonUri);
            const packageJson = JSON.parse(packageJsonBuffer.value.toString());

            const allDeps = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies
            };

            if (allDeps['vitest']) return 'vitest';
            if (allDeps['jest']) return 'jest';
            if (allDeps['mocha']) return 'mocha';

            // Check for scripts
            const scripts = packageJson.scripts || {};
            if (scripts.test?.includes('vitest')) return 'vitest';
            if (scripts.test?.includes('jest')) return 'jest';
            if (scripts.test?.includes('mocha')) return 'mocha';

        } catch {
            // Not a Node.js project
        }

        try {
            // Check for Python
            const pyprojectUri = URI.joinPath(workspaceRoot, 'pyproject.toml');
            const pyprojectBuffer = await this.fileService.readFile(pyprojectUri);
            const content = pyprojectBuffer.value.toString();

            if (content.includes('pytest')) return 'pytest';
        } catch {
            // Not a Python project with pyproject.toml
        }

        try {
            // Check for requirements.txt
            const requirementsUri = URI.joinPath(workspaceRoot, 'requirements.txt');
            const requirementsBuffer = await this.fileService.readFile(requirementsUri);
            const content = requirementsBuffer.value.toString();

            if (content.includes('pytest')) return 'pytest';
        } catch {
            // No requirements.txt
        }

        return 'unknown';
    }

    /**
     * Extract function signatures from code
     */
    public extractFunctions(code: string, language: string): FunctionSignature[] {
        const functions: FunctionSignature[] = [];

        if (language === 'typescript' || language === 'javascript') {
            // Match function declarations
            const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
            let match;
            while ((match = funcRegex.exec(code)) !== null) {
                functions.push({
                    name: match[1],
                    params: match[2] ? match[2].split(',').map(p => p.trim()) : [],
                    returnType: match[3]?.trim() || 'void',
                    isAsync: code.substring(match.index - 10, match.index).includes('async'),
                    body: this.extractFunctionBody(code, match.index + match[0].length)
                });
            }

            // Match arrow functions assigned to const/let
            const arrowRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/g;
            while ((match = arrowRegex.exec(code)) !== null) {
                functions.push({
                    name: match[1],
                    params: match[2] ? match[2].split(',').map(p => p.trim()) : [],
                    returnType: match[3]?.trim() || 'void',
                    isAsync: code.substring(match.index, match.index + 50).includes('async'),
                    body: ''
                });
            }
        }

        if (language === 'python') {
            const pyFuncRegex = /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+))?\s*:/g;
            let match;
            while ((match = pyFuncRegex.exec(code)) !== null) {
                functions.push({
                    name: match[1],
                    params: match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].trim()) : [],
                    returnType: match[3]?.trim() || 'None',
                    isAsync: code.substring(match.index - 10, match.index).includes('async'),
                    body: ''
                });
            }
        }

        return functions;
    }

    private extractFunctionBody(code: string, startIndex: number): string {
        let braceCount = 1;
        let i = startIndex;
        while (i < code.length && braceCount > 0) {
            if (code[i] === '{') braceCount++;
            if (code[i] === '}') braceCount--;
            i++;
        }
        return code.substring(startIndex, i - 1).trim();
    }

    /**
     * Generate test cases for a function
     */
    public generateTestCases(func: FunctionSignature, framework: TestFramework): TestCase[] {
        const tests: TestCase[] = [];

        // Basic test case
        tests.push({
            name: `should execute ${func.name} successfully`,
            description: `Basic test for ${func.name}`,
            code: this.generateBasicTest(func, framework),
            isAsync: func.isAsync
        });

        // Edge case: empty/null inputs
        if (func.params.length > 0) {
            tests.push({
                name: `should handle edge cases for ${func.name}`,
                description: `Edge case testing for ${func.name}`,
                code: this.generateEdgeCaseTest(func, framework),
                isAsync: func.isAsync
            });
        }

        return tests;
    }

    private generateBasicTest(func: FunctionSignature, framework: TestFramework): string {
        const asyncPrefix = func.isAsync ? 'async ' : '';
        const awaitPrefix = func.isAsync ? 'await ' : '';

        if (framework === 'jest' || framework === 'vitest') {
            return `
    it('should execute ${func.name} successfully', ${asyncPrefix}() => {
        // Arrange
        ${func.params.map(p => `const ${p.split(':')[0].trim()} = /* TODO: provide test value */;`).join('\n        ')}
        
        // Act
        const result = ${awaitPrefix}${func.name}(${func.params.map(p => p.split(':')[0].trim()).join(', ')});
        
        // Assert
        expect(result).toBeDefined();
    });`;
        }

        if (framework === 'pytest') {
            return `
def test_${func.name}_basic():
    # Arrange
    ${func.params.map(p => `${p} = None  # TODO: provide test value`).join('\n    ')}
    
    # Act
    result = ${func.name}(${func.params.join(', ')})
    
    # Assert
    assert result is not None`;
        }

        return `// Test for ${func.name}`;
    }

    private generateEdgeCaseTest(func: FunctionSignature, framework: TestFramework): string {
        const asyncPrefix = func.isAsync ? 'async ' : '';

        if (framework === 'jest' || framework === 'vitest') {
            return `
    it('should handle edge cases for ${func.name}', ${asyncPrefix}() => {
        // Test with undefined/null values
        expect(() => ${func.name}(${func.params.map(() => 'undefined').join(', ')})).not.toThrow();
    });`;
        }

        if (framework === 'pytest') {
            return `
def test_${func.name}_edge_cases():
    # Test with None values
    try:
        result = ${func.name}(${func.params.map(() => 'None').join(', ')})
    except Exception as e:
        pytest.fail(f"Unexpected exception: {e}")`;
        }

        return '';
    }

    /**
     * Generate complete test file
     */
    public generateTestFile(
        sourceFilePath: string,
        functions: FunctionSignature[],
        framework: TestFramework
    ): GeneratedTest {
        const testCases = functions.flatMap(f => this.generateTestCases(f, framework));
        const fileName = sourceFilePath.split('/').pop()?.replace(/\.(ts|js|py)$/, '') || 'module';

        let content = '';
        let testFilePath = '';

        if (framework === 'jest' || framework === 'vitest') {
            testFilePath = sourceFilePath.replace(/\.(ts|js)$/, '.test.$1');
            const importPath = `./${fileName}`;

            content = `import { ${functions.map(f => f.name).join(', ')} } from '${importPath}';

describe('${fileName}', () => {${testCases.map(tc => tc.code).join('\n')}
});
`;
        } else if (framework === 'pytest') {
            testFilePath = sourceFilePath.replace(/\.py$/, '_test.py');

            content = `import pytest
from ${fileName} import ${functions.map(f => f.name).join(', ')}

${testCases.map(tc => tc.code).join('\n')}
`;
        }

        return {
            filePath: testFilePath,
            content,
            framework
        };
    }

    /**
     * Write generated test to file system
     */
    public async writeTestFile(workspaceRoot: URI, test: GeneratedTest): Promise<URI> {
        const testUri = URI.joinPath(workspaceRoot, test.filePath);
        await this.fileService.writeFile(testUri, VSBuffer.fromString(test.content));
        this.logService.info(`[TestGenerator] Created test file: ${test.filePath}`);
        return testUri;
    }
}
