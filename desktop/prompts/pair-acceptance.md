这是 AgentHub 双人协商的认可确认轮。

请读取议题文件：
{{brief_path}}

请读取并维护当前协商记忆：
{{memory_path}}

{{previous_profile}} 已认可方案版本 {{proposal_version}}。请读取上一轮完整输出：
{{previous_artifact_path}}

上一轮摘要：
{{summary}}

请完成确认意见或最终修订，并把完整输出写入：
{{output_path}}

同时更新协商记忆：
{{memory_path}}

如果你也认可这个版本，最后只输出：
<agenthub>{"action":"accept","proposal_version":{{proposal_version}},"artifact_path":"{{output_path}}","summary":"认可原因"}</agenthub>

如果你仍然需要修改，最后只输出：
<agenthub>{"action":"continue","proposal_version":{{next_proposal_version}},"artifact_path":"{{output_path}}","summary":"修改点摘要"}</agenthub>

不要把完整正文放进 AgentHub 控制指令的 message 字段。不要把 AgentHub 控制指令交给 Bash、PowerShell 或其他工具执行；直接把它作为正文最后一行输出。
