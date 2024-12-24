// extension.ts
import * as vscode from 'vscode';
import axios from 'axios';

function calculateMaxTokens(prompt: string, codeLength: number): number {
    // GPT-3.5和GPT-4的最大token限制
    const MODEL_MAX_TOKENS = 4096; // 如果使用GPT-4可以改为8192或32768
    
    // 估算prompt的token数量（粗略估计：中文每字约2个token，英文每字约0.25个token）
    const estimatePromptTokens = (text: string): number => {
        const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const otherCharCount = text.length - chineseCharCount;
        return Math.ceil(chineseCharCount * 2 + otherCharCount * 0.25);
    };

    // 估算代码的token数量（粗略估计：每个字符约0.5个token）
    const estimateCodeTokens = (length: number): number => {
        return Math.ceil(length * 0.5);
    };

    // 预留给回复的token数量（根据经验设置，可调整）
    const RESPONSE_RESERVE_TOKENS = 1000;

    const promptTokens = estimatePromptTokens(prompt);
    const codeTokens = estimateCodeTokens(codeLength);
    
    // 计算最大可用tokens
    const maxTokens = MODEL_MAX_TOKENS - promptTokens - codeTokens - RESPONSE_RESERVE_TOKENS;
    
    // 确保返回值在合理范围内
    return Math.max(100, Math.min(maxTokens, MODEL_MAX_TOKENS));
}


export function activate(context: vscode.ExtensionContext) {
    // 注册命令
    let disposable = vscode.commands.registerCommand('code-review.reviewChanges', async () => {
        console.log('Review command triggered');

        // 获取git扩展
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            vscode.window.showErrorMessage('Git extension not found');
            return;
        }

        const git = gitExtension.exports.getAPI(1);
        const repository = git.repositories[0];

        if (!repository) {
            vscode.window.showErrorMessage('No repository found');
            return;
        }

        const changes = repository.state.indexChanges;
        if (changes.length === 0) {
            vscode.window.showInformationMessage('No staged changes found');
            return;
        }

        // 收集所有变更的内容
        // 获取staged changes
        let changesContent = "";
        for (const change of repository.state.indexChanges) {
            // 获取文件的 diff
            const diff = await repository.diffIndexWithHEAD(change.uri.fsPath);
            console.log('Staged changes diff:', diff);
            changesContent += diff;
            // 获取完整的文件内容
            // const content = await vscode.workspace.fs.readFile(change.uri);
            // const fileContent = Buffer.from(content).toString('utf8');
            // console.log('Current file content:', fileContent);
        }
        console.log(changesContent);

        // 创建或显示输出面板
        const panel = vscode.window.createWebviewPanel(
            'codeReview',
            'AI Code Review',
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        try {
            const config = vscode.workspace.getConfiguration('codeReview');
            const value = config.get('dropdown');
            const prompt = config.get('prompt') as string;

            if (value === "Claude") {
                // 调用 Claude API
                const claudeResponse = await reviewWithClaude(changesContent,prompt);
                panel.webview.html = getWebviewContent(claudeResponse);
            } else if (value === "OpenAI") {
                // 调用 OpenAI API
                const openaiResponse = await reviewWithOpenAI(changesContent,prompt);
                panel.webview.html = getWebviewContent(openaiResponse);
            }
            // 显示结果
        } catch (error) {
            vscode.window.showErrorMessage('Error reviewing code: ' + (error as Error).message);
        }
    });

    context.subscriptions.push(disposable);
}

async function reviewWithClaude(content: string, prompt:string): Promise<string> {
    const config = vscode.workspace.getConfiguration('codeReview');
    const CLAUDE_API_KEY = config.get('claudeApiKey');
    const CLAUDE_API_URL = config.get('claudeApiUrl');
    const claudeModel = config.get('claudeModel');

    if (!CLAUDE_API_KEY) {
        throw new Error('Claude API key not configured');
    }

    if (!CLAUDE_API_URL) {
        throw new Error('Claude API URL not configured');
    }

    if (!claudeModel) {
        throw new Error('Claude Model not configured');
    }

    try {
        const response = await axios.post(CLAUDE_API_URL as string, {
            messages: [{
                role: 'user',
                content: `${prompt}\n${content}`
            }],
            model: claudeModel,
            max_tokens: calculateMaxTokens(prompt, content.length)
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY
            }
        });

        return response.data.content;
    } catch (error) {
        throw new Error('Claude API error: ' + (error as Error).message);
    }
}

async function reviewWithOpenAI(content: string,prompt :string): Promise<string> {
    const config = vscode.workspace.getConfiguration('codeReview');
    const OPENAI_API_KEY = config.get('openaiApiKey');
    const OPENAI_API_URL = config.get('openaiApiUrl');
    const openAIModel = config.get('openaiModel');


    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
    }

    if (!OPENAI_API_URL) {
        throw new Error('OpenAI API URL not configured');
    }

    if (!openAIModel) {
        throw new Error('OpenAI Model not configured');
    }

    try {
        const response = await axios.post(OPENAI_API_URL as string, {
            messages: [{
                role: 'user',
                content: `${prompt}\n${content}`
            }],
            model: openAIModel,
            max_tokens: calculateMaxTokens(prompt, content.length)
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        throw new Error('OpenAI API error: ' + (error as Error).message);
    }
}

function getWebviewContent(content: string) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { 
                    font-family: Arial, sans-serif;
                    margin: 20px;
                }
                .tab {
                    overflow: hidden;
                    border: 1px solid #ccc;
                    background-color: var(--vscode-editor-background);
                }
                .tab button {
                    background-color: inherit;
                    float: left;
                    border: none;
                    outline: none;
                    cursor: pointer;
                    padding: 14px 16px;
                    color: var(--vscode-editor-foreground);
                }
                .tab button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .tab button.active {
                    background-color: var(--vscode-button-background);
                }
                .tabcontent {
                    display: none;
                    padding: 6px 12px;
                    border: 1px solid #ccc;
                    border-top: none;
                }
            </style>
        </head>
        <body>
            <div class="tabcontent">
                <pre>${content}</pre>
            </div>
        </body>
        </html>
    `;
}

export function deactivate() { }