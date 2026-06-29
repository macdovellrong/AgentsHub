using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AgentHub.Native.Core.Hooks;

public sealed class AgentHookReceiver : IAsyncDisposable
{
    private const int MaxHeaderBytes = 32 * 1024;
    private const int MaxBodyBytes = 1024 * 1024;

    private readonly AgentHookReceiverOptions options;
    private TcpListener? listener;
    private CancellationTokenSource? cancellation;
    private Task? acceptTask;
    private AgentHookReceiverInfo? info;

    public AgentHookReceiver(AgentHookReceiverOptions options)
    {
        this.options = options;
    }

    public event EventHandler<AgentHookEvent>? EventReceived;

    public Task<AgentHookReceiverInfo> StartAsync(CancellationToken cancellationToken = default)
    {
        if (info is not null)
        {
            return Task.FromResult(info);
        }

        listener = new TcpListener(IPAddress.Loopback, options.Port);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        info = new AgentHookReceiverInfo($"http://127.0.0.1:{port}/api/agent-result", options.Token);
        cancellation = new CancellationTokenSource();
        acceptTask = Task.Run(() => AcceptLoopAsync(cancellation.Token), cancellationToken);
        return Task.FromResult(info);
    }

    public async ValueTask DisposeAsync()
    {
        cancellation?.Cancel();
        listener?.Stop();
        if (acceptTask is not null)
        {
            try
            {
                await acceptTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
            catch (SocketException)
            {
            }
        }

        cancellation?.Dispose();
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        if (listener is null)
        {
            return;
        }

        while (!cancellationToken.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (SocketException)
            {
                break;
            }

            _ = Task.Run(() => HandleClientAsync(client, cancellationToken), cancellationToken);
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using var clientScope = client;
        var stream = client.GetStream();

        try
        {
            var headerBytes = await ReadHeadersAsync(stream, cancellationToken).ConfigureAwait(false);
            var headerText = Encoding.ASCII.GetString(headerBytes);
            var request = ParseRequest(headerText);
            if (!string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(request.Path, "/api/agent-result", StringComparison.Ordinal))
            {
                _ = await ReadBodyByHeadersAsync(stream, request.Headers, cancellationToken).ConfigureAwait(false);
                await WriteJsonAsync(stream, 404, """{"ok":false,"error":"not_found"}""", cancellationToken)
                    .ConfigureAwait(false);
                return;
            }

            var body = await ReadBodyByHeadersAsync(stream, request.Headers, cancellationToken).ConfigureAwait(false);
            if (!request.Headers.TryGetValue("X-AgentHub-Token", out var token) || token != options.Token)
            {
                await WriteJsonAsync(stream, 401, """{"ok":false,"error":"invalid_token"}""", cancellationToken)
                    .ConfigureAwait(false);
                return;
            }

            var hookEvent = ParseHookEvent(body);
            EventReceived?.Invoke(this, hookEvent);
            await WriteJsonAsync(stream, 200, """{"ok":true}""", cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            await WriteJsonAsync(stream, 400, """{"ok":false,"error":"bad_request"}""", cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private static async Task<byte[]> ReadHeadersAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new List<byte>();
        var one = new byte[1];
        while (buffer.Count < MaxHeaderBytes)
        {
            var read = await stream.ReadAsync(one, cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            buffer.Add(one[0]);
            var count = buffer.Count;
            if (count >= 4 &&
                buffer[count - 4] == '\r' &&
                buffer[count - 3] == '\n' &&
                buffer[count - 2] == '\r' &&
                buffer[count - 1] == '\n')
            {
                return buffer.ToArray();
            }
        }

        throw new InvalidOperationException("Invalid HTTP headers.");
    }

    private static async Task<string> ReadBodyByHeadersAsync(
        NetworkStream stream,
        IReadOnlyDictionary<string, string> headers,
        CancellationToken cancellationToken)
    {
        if (headers.TryGetValue("Transfer-Encoding", out var transferEncoding) &&
            transferEncoding.Contains("chunked", StringComparison.OrdinalIgnoreCase))
        {
            return await ReadChunkedBodyAsync(stream, cancellationToken).ConfigureAwait(false);
        }

        if (!headers.TryGetValue("Content-Length", out var contentLengthText))
        {
            return "";
        }

        if (!int.TryParse(contentLengthText, out var contentLength) || contentLength < 0 || contentLength > MaxBodyBytes)
        {
            throw new InvalidOperationException("Invalid content length.");
        }

        return await ReadFixedLengthBodyAsync(stream, contentLength, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<string> ReadFixedLengthBodyAsync(
        NetworkStream stream,
        int contentLength,
        CancellationToken cancellationToken)
    {
        var body = new byte[contentLength];
        var offset = 0;
        while (offset < contentLength)
        {
            var read = await stream.ReadAsync(body.AsMemory(offset, contentLength - offset), cancellationToken)
                .ConfigureAwait(false);
            if (read == 0)
            {
                throw new InvalidOperationException("Unexpected end of request body.");
            }

            offset += read;
        }

        return Encoding.UTF8.GetString(body);
    }

    private static async Task<string> ReadChunkedBodyAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        using var body = new MemoryStream();
        while (true)
        {
            var sizeLine = await ReadAsciiLineAsync(stream, cancellationToken).ConfigureAwait(false);
            var semicolon = sizeLine.IndexOf(';', StringComparison.Ordinal);
            var sizeText = semicolon >= 0 ? sizeLine[..semicolon] : sizeLine;
            var size = Convert.ToInt32(sizeText.Trim(), 16);
            if (size == 0)
            {
                _ = await ReadAsciiLineAsync(stream, cancellationToken).ConfigureAwait(false);
                break;
            }

            if (body.Length + size > MaxBodyBytes)
            {
                throw new InvalidOperationException("Request body is too large.");
            }

            var buffer = new byte[size];
            var offset = 0;
            while (offset < size)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(offset, size - offset), cancellationToken)
                    .ConfigureAwait(false);
                if (read == 0)
                {
                    throw new InvalidOperationException("Unexpected end of chunked request body.");
                }

                offset += read;
            }

            body.Write(buffer, 0, buffer.Length);
            _ = await ReadAsciiLineAsync(stream, cancellationToken).ConfigureAwait(false);
        }

        return Encoding.UTF8.GetString(body.ToArray());
    }

    private static async Task<string> ReadAsciiLineAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new List<byte>();
        var one = new byte[1];
        while (buffer.Count < MaxHeaderBytes)
        {
            var read = await stream.ReadAsync(one, cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                throw new InvalidOperationException("Unexpected end of line.");
            }

            if (one[0] == '\n')
            {
                if (buffer.Count > 0 && buffer[^1] == '\r')
                {
                    buffer.RemoveAt(buffer.Count - 1);
                }

                return Encoding.ASCII.GetString(buffer.ToArray());
            }

            buffer.Add(one[0]);
        }

        throw new InvalidOperationException("HTTP line is too long.");
    }

    private static AgentHookEvent ParseHookEvent(string body)
    {
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        var workspace = RequiredString(root, "workspace");
        var message = RequiredString(root, "message");
        return new AgentHookEvent(
            workspace,
            message,
            OptionalString(root, "profileId"),
            OptionalString(root, "agenthubSessionId"),
            OptionalString(root, "runId"),
            OptionalString(root, "source"),
            OptionalString(root, "planId") ?? OptionalString(root, "plan_id"),
            OptionalString(root, "taskId") ?? OptionalString(root, "task_id"));
    }

    private static string RequiredString(JsonElement root, string propertyName)
    {
        var value = OptionalString(root, propertyName);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"missing_{propertyName}");
        }

        return value;
    }

    private static string? OptionalString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static ParsedHttpRequest ParseRequest(string headerText)
    {
        var lines = headerText.Split("\r\n", StringSplitOptions.None);
        var requestLine = lines[0].Split(' ', 3);
        if (requestLine.Length < 2)
        {
            throw new InvalidOperationException("Invalid request line.");
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0)
            {
                break;
            }

            var separator = line.IndexOf(':', StringComparison.Ordinal);
            if (separator <= 0)
            {
                continue;
            }

            headers[line[..separator]] = line[(separator + 1)..].Trim();
        }

        return new ParsedHttpRequest(requestLine[0], requestLine[1], headers);
    }

    private static async Task WriteJsonAsync(
        NetworkStream stream,
        int statusCode,
        string json,
        CancellationToken cancellationToken)
    {
        var reason = statusCode switch
        {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            _ => "Error"
        };
        var body = Encoding.UTF8.GetBytes(json);
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {statusCode} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(body, cancellationToken).ConfigureAwait(false);
    }

    private sealed record ParsedHttpRequest(
        string Method,
        string Path,
        IReadOnlyDictionary<string, string> Headers);
}
