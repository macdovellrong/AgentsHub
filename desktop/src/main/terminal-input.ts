export function toSubmittedTerminalInput(message: string): string {
  if (message.endsWith("\r\n")) {
    return message;
  }
  if (message.endsWith("\r") || message.endsWith("\n")) {
    return `${message.replace(/[\r\n]+$/g, "")}\r\n`;
  }
  return `${message}\r\n`;
}
