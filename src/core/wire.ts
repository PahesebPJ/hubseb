export interface WireSuccess<T = unknown> {
  protocol: 'hubseb/v1'
  status: 'success'
  action: string
  ts: number
  payload: T
}

export interface WireFailure {
  protocol: 'hubseb/v1'
  status: 'error'
  action: string
  ts: number
  fault: {
    code: string
    reason: string
    remedy?: string
  }
}

export type WirePacket<T = unknown> = WireSuccess<T> | WireFailure

export function wireSuccess<T>(action: string, payload: T): WireSuccess<T> {
  return {
    protocol: 'hubseb/v1',
    status: 'success',
    action,
    ts: Date.now(),
    payload,
  }
}

export function wireFailure(
  action: string,
  code: string,
  reason: string,
  remedy?: string,
): WireFailure {
  return {
    protocol: 'hubseb/v1',
    status: 'error',
    action,
    ts: Date.now(),
    fault: remedy ? { code, reason, remedy } : { code, reason },
  }
}

export function serializeWire<T>(packet: WirePacket<T>): string {
  return `${JSON.stringify(packet)}\n`
}

export function decodeWire<T = unknown>(raw: string): WirePacket<T> {
  const line =
    raw
      .trim()
      .split('\n')
      .find((l) => l.trim().startsWith('{')) ?? raw.trim()
  const parsed = JSON.parse(line) as WirePacket<T>
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.protocol !== 'hubseb/v1' ||
    (parsed.status !== 'success' && parsed.status !== 'error')
  ) {
    throw new Error('Invalid hubseb/v1 wire packet')
  }
  return parsed
}
