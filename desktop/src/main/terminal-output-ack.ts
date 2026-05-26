export function countUtf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function subtractAckedBytes(currentUnackedBytes: number, ackedBytes: number): number {
  return Math.max(0, currentUnackedBytes - ackedBytes);
}
