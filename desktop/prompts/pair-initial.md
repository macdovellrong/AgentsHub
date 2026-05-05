这是 AgentHub 双人协商的第一轮。

议题标题：
{{topic}}

请先读取议题文件：
{{brief_path}}

把你的完整方案写入：
{{output_path}}

同时更新协商记忆：
{{memory_path}}

写完文件后，最后只输出一行 AgentHub 控制指令。需要对方审查或继续修订时输出：
<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"{{output_path}}","summary":"一句话摘要"}</agenthub>

只有你认为方案已经可以交付时，才输出：
<agenthub>{"action":"accept","proposal_version":1,"artifact_path":"{{output_path}}","summary":"认可原因"}</agenthub>

不要把完整正文放进 AgentHub 控制指令的 message 字段。不要把 AgentHub 控制指令交给 Bash、PowerShell 或其他工具执行；直接把它作为正文最后一行输出。
