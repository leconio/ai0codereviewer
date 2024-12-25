// extension.ts
import * as vscode from "vscode";
import axios from "axios";
interface LineMapping {
  oldLineNumber: number;
  newLineNumber: number;
  content: string;
}

function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} {
  // 解析类似 "@@ -1,7 +1,6 @@" 的格式
  const matches = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!matches) {
    return { oldStart: 0, oldCount: 0, newStart: 0, newCount: 0 };
  }

  return {
    oldStart: parseInt(matches[1]),
    oldCount: matches[2] ? parseInt(matches[2]) : 1,
    newStart: parseInt(matches[3]),
    newCount: matches[4] ? parseInt(matches[4]) : 1,
  };
}

function addLineNumbers(diff: string): string {
  const lines: string[] = diff.split("\n");
  let oldLineNum: number = 0;
  let newLineNum: number = 0;
  let currentHunk = { oldStart: 0, oldCount: 0, newStart: 0, newCount: 0 };

  const mappedLines: LineMapping[] = lines.map((line: string): LineMapping => {
    // 处理 diff 头部信息
    if (line.startsWith("+++") || line.startsWith("---")) {
      return {
        oldLineNumber: -1,
        newLineNumber: -1,
        content: line,
      };
    }

    // 处理 hunk 头部
    if (line.startsWith("@@")) {
      currentHunk = parseHunkHeader(line);
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      return {
        oldLineNumber: -1,
        newLineNumber: -1,
        content: line,
      };
    }

    // 处理实际的代码行
    if (line.startsWith("+")) {
      return {
        oldLineNumber: -1,
        newLineNumber: newLineNum++,
        content: line,
      };
    } else if (line.startsWith("-")) {
      return {
        oldLineNumber: oldLineNum++,
        newLineNumber: -1,
        content: line,
      };
    } else {
      return {
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
        content: line,
      };
    }
  });

  return mappedLines
    .map(({ oldLineNumber, newLineNumber, content }: LineMapping) => {
      const oldNum =
        oldLineNumber > 0 ? oldLineNumber.toString().padStart(4) : "    ";
      const newNum =
        newLineNumber > 0 ? newLineNumber.toString().padStart(4) : "    ";
      return `${oldNum} ${newNum} ${content}`;
    })
    .join("\n");
}

class ReviewWebviewProvider {
  private static readonly viewType = "codeReview";
  panel: vscode.WebviewPanel | undefined;
  isReady: boolean = false;

  constructor(private context: vscode.ExtensionContext) {}

  public show() {
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        ReviewWebviewProvider.viewType,
        "AI Code Review",
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      // 确保面板创建后立即设置HTML内容
      this.panel.webview.html = this.getHtmlContent();

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    return this.panel;
  }

  public appendContent(content: string) {
    if (this.panel) {
      this.panel.webview.postMessage({
        command: "append",
        content: content,
      });
    }
  }

  public replaceContent(content: string) {
    if (this.panel) {
      this.panel.webview.postMessage({
        command: "replace",
        content: content,
      });
    }
  }

  private getHtmlContent() {
    // 这里返回上面的 HTML 模板内容
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Code Review</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            line-height: 1.6;
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
        #content {
            max-width: 800px;
            margin: 0 auto;
        }
        pre {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: 'Courier New', Courier, monospace;
        }
    </style>
</head>
<body>
    <div id="content"></div>
    <script>
        window.onload = () => {
            console.log('Webview content script loaded');
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'ready' });
        };
        marked.setOptions({
            highlight: function(code, lang) {
                return code;
            }
        });

        let content = '';
        const contentDiv = document.getElementById('content');

        window.addEventListener('message', event => {
            const message = event.data; // 先初始化 message
            console.log('Message received in Webview:', message); // 然后使用
            switch (message.command) {
                case 'append':
                    content += message.content;
                    contentDiv.innerHTML = marked.parse(content);
                    break;
                case 'replace':
                    content = message.content;
                    contentDiv.innerHTML = marked.parse(content);
                    break;
            }
        });
    </script>
</body>
</html>`; // 完整的 HTML 内容
  }
}

export function activate(context: vscode.ExtensionContext) {
  const webviewProvider = new ReviewWebviewProvider(context);

  // 注册命令
  let disposable = vscode.commands.registerCommand(
    "code-review.reviewChanges",
    async () => {
      console.log("Review command triggered");
      // 获取git扩展
      const gitExtension = vscode.extensions.getExtension("vscode.git");
      if (!gitExtension) {
        vscode.window.showErrorMessage("Git extension not found");
        return;
      }

      const git = gitExtension.exports.getAPI(1);
      const repository = git.repositories[0];

      if (!repository) {
        vscode.window.showErrorMessage("No repository found");
        return;
      }

      const changes = repository.state.indexChanges;
      if (changes.length === 0) {
        vscode.window.showInformationMessage("No staged changes found");
        return;
      }

      // 收集所有变更的内容
      // 获取staged changes
      let changesContent = "";
      for (const change of repository.state.indexChanges) {
        // 获取文件的 diff
        const diff = await repository.diffIndexWithHEAD(change.uri.fsPath);
        changesContent += addLineNumbers(diff);
        // 获取完整的文件内容
        // const content = await vscode.workspace.fs.readFile(change.uri);
        // const fileContent = Buffer.from(content).toString('utf8');
        console.log("Current file content:", changesContent);
      }
      webviewProvider.show();
      if (webviewProvider.isReady) {
        await reqAI(changesContent);
      } else {
        webviewProvider.panel?.webview.onDidReceiveMessage(async (message) => {
          if (message.command === "ready") {
            webviewProvider.isReady = true;
            await reqAI(changesContent);
          }
        });
      }
    }
  );

  context.subscriptions.push(disposable);

  async function reqAI(changesContent: string) {
    try {
      webviewProvider.replaceContent("");
      const config = vscode.workspace.getConfiguration("codeReview");
      const value = config.get("dropdown");
      const prompt = config.get("prompt") as string;

      if (value === "Claude") {
        // 调用 Claude API
        await reviewWithClaude(changesContent, prompt, webviewProvider);
      } else if (value === "OpenAI") {
        // 调用 OpenAI API
        await reviewWithOpenAI(changesContent, prompt, webviewProvider);
      }
      // 显示结果
    } catch (error) {
      vscode.window.showErrorMessage(
        "Error reviewing code: " + (error as Error).message
      );
    }
  }
}

async function reviewWithClaude(
  content: string,
  prompt: string,
  webviewProvider: ReviewWebviewProvider
) {
  const config = vscode.workspace.getConfiguration("codeReview");
  const CLAUDE_API_KEY = config.get("claudeApiKey");
  const CLAUDE_API_URL = config.get("claudeApiUrl");
  const claudeModel = config.get("claudeModel");

  if (!CLAUDE_API_KEY) {
    throw new Error("Claude API key not configured");
  }

  if (!CLAUDE_API_URL) {
    throw new Error("Claude API URL not configured");
  }

  if (!claudeModel) {
    throw new Error("Claude Model not configured");
  }

  try {
    const response = await axios.post(
      CLAUDE_API_URL as string,
      {
        messages: [
          {
            role: "user",
            content: `${prompt}\n${content}`,
          },
        ],
        model: claudeModel,
        max_tokens: 4096,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
        },
        responseType: "stream",
      }
    );

    for await (const chunk of response.data) {
      const text = chunk.toString();
      try {
        const parsed = JSON.parse(text);
        if (parsed.content) {
          webviewProvider.appendContent(parsed.content);
        }
      } catch (e) {
        console.error("Error parsing chunk:", e);
      }
    }
  } catch (error) {
    throw new Error("Claude API error: " + (error as Error).message);
  }
}

async function reviewWithOpenAI(
  content: string,
  prompt: string,
  webviewProvider: ReviewWebviewProvider
) {
  const config = vscode.workspace.getConfiguration("codeReview");
  const OPENAI_API_KEY = config.get("openaiApiKey");
  const OPENAI_API_URL = config.get("openaiApiUrl");
  const openAIModel = config.get("openaiModel");

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  if (!OPENAI_API_URL) {
    throw new Error("OpenAI API URL not configured");
  }

  if (!openAIModel) {
    throw new Error("OpenAI Model not configured");
  }

  try {
    const response = await fetch(OPENAI_API_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `${prompt}\n${content}`,
          },
        ],
        model: openAIModel,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (reader) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.choices && data.choices[0].delta.content) {
              const content = data.choices[0].delta.content;
              webviewProvider.appendContent(content);
            }
          } catch (e) {
            console.error("Error parsing JSON:", e, "Line:", line);
          }
        }
      }
    }
  } catch (error) {
    console.error(error);
    throw new Error("OpenAI API error: " + (error as Error).message);
  }
}

export function deactivate() {}
