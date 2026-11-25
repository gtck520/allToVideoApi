// 重试基础设施：错误分类 + 指数退避 + 抖动
// 设计原则：
//   - 可重试错误：网络类（fetch failed/ECONNRESET/超时）、传输层 429/5xx、服务端瞬时商业错误（COMMERCIAL_BLOCKED/算力不足/系统繁忙）
//   - 不可重试错误：参数校验类（pydantic validation）、明确的鉴权/权限问题、工具不存在
//   - 所有涉及生成的重试都必须复用同一幂等键（服务端已实测验证幂等重放安全）

const RETRYABLE_NET = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network|aborted|timeout|timed out|UND_ERR/i
const RETRYABLE_BIZ = /COMMERCIAL_BLOCKED|算力不足|系统繁忙|系统开小差|try again later|rate limit|too many requests|temporarily|服务暂不可用|内部错误|internal error|bad gateway|service unavailable/i
const FATAL = /validation error|Extra inputs are not permitted|Field required|Unknown tool|invalid_request|未授权|授权已失效|forbidden|not found|不能使用数字/i

export class NonRetryableError extends Error {
  constructor(message, { code = 'invalid_request', httpStatus = 400 } = {}) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
  }
}

/** 判断一个错误/错误文本是否可重试 */
export function isRetryable(err) {
  if (err instanceof NonRetryableError) return false
  const text = String(err?.message || err || '')
  if (FATAL.test(text)) return false
  if (RETRYABLE_NET.test(text)) return true
  if (RETRYABLE_BIZ.test(text)) return true
  // MCP 工具调用返回 isError=true 且文本命中可重试模式的情况在 classifyTool 里处理
  return false
}

/** 判断 MCP 工具调用的 isError 文本是否可重试（服务端错误多为文本形式） */
export function isRetryableToolText(text) {
  if (!text) return false
  if (FATAL.test(text)) return false
  return RETRYABLE_NET.test(text) || RETRYABLE_BIZ.test(text)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 指数退避：base * 2^attempt + 抖动，封顶 max */
export function backoffMs(attempt, { base = 1000, max = 30000 } = {}) {
  return Math.min(max, base * 2 ** attempt) + Math.floor(Math.random() * 500)
}

/**
 * 通用重试执行器。
 * @param {object} opts
 *   attempts        最大尝试次数（含首次）
 *   onRetry         (err, attempt, waitMs) => void  回调用于日志
 *   shouldRetry     (err) => boolean  默认 isRetryable
 */
export async function withRetry(fn, { attempts = 4, base = 1000, max = 30000, onRetry, shouldRetry = isRetryable } = {}) {
  let lastErr
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      const isLast = attempt === attempts - 1
      if (isLast || !shouldRetry(err)) throw err
      const waitMs = backoffMs(attempt, { base, max })
      onRetry?.(err, attempt + 1, waitMs)
      await sleep(waitMs)
    }
  }
  throw lastErr
}
