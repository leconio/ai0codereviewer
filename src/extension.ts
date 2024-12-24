// extension.ts
import * as vscode from 'vscode';
import axios from 'axios';

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

        // 获取staged changes
        const changes = repository.state.indexChanges;
        if (changes.length === 0) {
            vscode.window.showInformationMessage('No staged changes found');
            return;
        }

        // 收集所有变更的内容
        let changesContent = '';
        for (const change of changes) {
            const uri = change.uri;
            const document = await vscode.workspace.openTextDocument(uri);
            changesContent += `File: ${uri.fsPath}\n`;
            changesContent += `Content:\n${document.getText()}\n\n`;
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
            // 调用 Claude API
            const claudeResponse = await reviewWithClaude(changesContent);
            // 调用 OpenAI API
            const openaiResponse = await reviewWithOpenAI(changesContent);

            // 显示结果
            panel.webview.html = getWebviewContent(claudeResponse, openaiResponse);
        } catch (error) {
            vscode.window.showErrorMessage('Error reviewing code: ' + (error as Error).message);
        }
    });

    context.subscriptions.push(disposable);
}

async function reviewWithClaude(content: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('codeReview');
    const CLAUDE_API_KEY = config.get('claudeApiKey');
    const CLAUDE_API_URL = config.get('claudeApiUrl');

    if (!CLAUDE_API_KEY) {
        throw new Error('Claude API key not configured');
    }

    if (!CLAUDE_API_URL) {
        throw new Error('Claude API URL not configured');
    }

    try {
        const response = await axios.post(CLAUDE_API_URL as string, {
            messages: [{
                role: 'user',
                content: `Please review the following code changes and provide feedback:\n${content}`
            }],
            model: 'claude-3-opus-20240229',
            max_tokens: 1000
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

async function reviewWithOpenAI(content: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('codeReview');
    const OPENAI_API_KEY = config.get('openaiApiKey');
    const OPENAI_API_URL = config.get('openaiApiUrl');

    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
    }

    if (!OPENAI_API_URL) {
        throw new Error('OpenAI API URL not configured');
    }

    try {
        const response = await axios.post(OPENAI_API_URL as string, {
            messages: [{
                role: 'user',
                content: `Please review the following code changes and provide feedback:\n${content}`
            }],
            model: 'gpt-4',
            max_tokens: 1000
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        throw new Error('OpenAI API error: ' + (error as Error)	.message);
    }
}

function getWebviewContent(claudeResponse: string, openaiResponse: string) {
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
            <div class="tab">
                <button class="tablinks" onclick="openTab(event, 'Claude')">Claude Review</button>
                <button class="tablinks" onclick="openTab(event, 'OpenAI')">OpenAI Review</button>
            </div>

            <div id="Claude" class="tabcontent">
                <pre>${claudeResponse}</pre>
            </div>

            <div id="OpenAI" class="tabcontent">
                <pre>${openaiResponse}</pre>
            </div>

            <script>
                function openTab(evt, tabName) {
                    var i, tabcontent, tablinks;
                    tabcontent = document.getElementsByClassName("tabcontent");
                    for (i = 0; i < tabcontent.length; i++) {
                        tabcontent[i].style.display = "none";
                    }
                    tablinks = document.getElementsByClassName("tablinks");
                    for (i = 0; i < tablinks.length; i++) {
                        tablinks[i].className = tablinks[i].className.replace(" active", "");
                    }
                    document.getElementById(tabName).style.display = "block";
                    evt.currentTarget.className += " active";
                }
                // 默认显示Claude标签页
                document.getElementsByClassName("tablinks")[0].click();
            </script>
        </body>
        </html>
    `;
}

export function deactivate() {}