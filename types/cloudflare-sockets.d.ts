/**
 * cloudflare:sockets 的最小类型声明（workerd 专属模块，npm 无包）。
 * 仅覆盖 lib/mailer/smtp.ts 用到的 connect 与 Socket 形状。
 *
 * 注意：smtp.ts 里是通过运行时拼接的变量动态 import 的（不是字面量
 * `import("cloudflare:sockets")`），因此该 declare module 实际不参与解析，
 * 这里只作为文档保留，类型上用的是函数内的局部 as 断言。
 */
declare module "cloudflare:sockets" {
  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close(): void;
    startTls(options?: { expectedServerHostname?: string }): Socket;
  }
  export function connect(
    address: string,
    options?: {
      secureTransport?: "on" | "off" | "starttls";
      allowHalfOpen?: boolean;
    },
  ): Socket;
}
