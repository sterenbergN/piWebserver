// Loop Lab PLCSIM bridge.
//
// Lets the Loop Lab page (https://noahstuf.com/loop-lab) run its plant against a
// virtual S7-1500 in S7-PLCSIM Advanced, cycle by cycle. The page connects to
// ws://localhost:8765; the bridge drives the instance through the PLCSIM Advanced
// API in "time span synchronized" mode, so the PLC's clock only moves when the
// plant's does. Protocol: see lib/loop-lab/plcsim.ts.

using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LoopLab.PlcsimBridge;

var opts = Options.Parse(args);
if (opts.Help)
{
    Console.WriteLine("""
        Loop Lab PLCSIM bridge
          -port <n>      WebSocket port on localhost (default 8765)
          -mock          No PLCSIM: a stand-in PLC that holds the valves at their manual values
          -origin <url>  Also accept pages from this origin (repeatable)
        """);
    return;
}
var builder = WebApplication.CreateSlimBuilder();
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(opts.Port));
var app = builder.Build();
app.UseWebSockets();

var busy = 0;
app.Map("/", async ctx =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        await ctx.Response.WriteAsync("Loop Lab PLCSIM bridge. Connect from the Loop Lab page.");
        return;
    }
    var origin = ctx.Request.Headers.Origin.ToString();
    if (!opts.Allows(origin))
    {
        Console.WriteLine($"Refused a connection from {origin} (start with -origin {origin} to allow it)");
        ctx.Response.StatusCode = 403;
        return;
    }
    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    if (Interlocked.Exchange(ref busy, 1) == 1)
    {
        await Session.Send(ws, new JsonObject { ["op"] = "error", ["message"] = "The bridge is already in use by another page." });
        await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "busy", CancellationToken.None);
        return;
    }
    Console.WriteLine($"Connected: {(origin == "" ? "(no origin)" : origin)}");
    IBackend backend = opts.Mock ? new MockBackend() : new PlcsimBackend();
    try { await new Session(ws, backend).Run(); }
    catch (Exception e) when (e is WebSocketException or OperationCanceledException) { }
    finally
    {
        try { backend.Detach(); } catch (Exception e) { Console.WriteLine($"Detach: {e.Message}"); }
        Interlocked.Exchange(ref busy, 0);
        Console.WriteLine("Disconnected");
    }
});

Console.WriteLine($"Loop Lab PLCSIM bridge on ws://localhost:{opts.Port}/ ({(opts.Mock ? "mock PLC" : "PLCSIM Advanced")}). Ctrl+C to stop.");
if (!opts.Mock)
{
    try { Console.WriteLine(PlcsimBackend.Describe()); }
    catch (Exception e) { Console.WriteLine($"PLCSIM Advanced not reachable yet: {e.Message}"); }
}
app.Run();

namespace LoopLab.PlcsimBridge
{
    using Siemens.Simatic.Simulation.Runtime;

    sealed class Options
    {
        public int Port = 8765;
        public bool Mock, Help;
        public List<string> Origins = ["https://noahstuf.com", "https://www.noahstuf.com"];

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (var i = 0; i < args.Length; i++)
            {
                var a = args[i].TrimStart('-').ToLowerInvariant();
                if (a == "port" && i + 1 < args.Length) o.Port = int.Parse(args[++i]);
                else if (a == "mock") o.Mock = true;
                else if (a == "origin" && i + 1 < args.Length) o.Origins.Add(args[++i].TrimEnd('/'));
                else o.Help = true;
            }
            return o;
        }

        /// <summary>The page's origin: this site, a local dev server, or one given with -origin. No origin = not a browser.</summary>
        public bool Allows(string origin)
        {
            if (origin == "") return true;
            if (Origins.Contains(origin.TrimEnd('/'), StringComparer.OrdinalIgnoreCase)) return true;
            return Uri.TryCreate(origin, UriKind.Absolute, out var u) && (u.Host == "localhost" || u.Host == "127.0.0.1" || u.Host == "[::1]");
        }
    }

    static class ApiLoader
    {
        /// <summary>Load the API from the PLCSIM Advanced install it was built against (it is not copied next to the bridge).</summary>
        [System.Runtime.CompilerServices.ModuleInitializer]
        internal static void Init()
        {
            var dir = typeof(Options).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "PlcsimApiDir")?.Value;
            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
            {
                var name = new AssemblyName(e.Name).Name;
                if (dir == null || name == null || !name.StartsWith("Siemens.Simatic.Simulation.Runtime")) return null;
                var path = Path.Combine(dir, name + ".dll");
                return File.Exists(path) ? Assembly.LoadFrom(path) : null;
            };
        }

    }

    /// <summary>A signal the page writes or reads each cycle.</summary>
    sealed record Signal(string Tag, string Type, string? Role);

    sealed record StepResult(double[] Values, int Ran, bool Late, double Time);

    interface IBackend
    {
        JsonObject Hello();
        JsonObject Attach(string instance, double ts, Signal[] write, Signal[] read, string counter);
        StepResult Step(double[] values, int cycles);
        void Detach();
    }

    sealed class Session(WebSocket ws, IBackend backend)
    {
        public static Task Send(WebSocket ws, JsonObject msg) =>
            ws.SendAsync(Encoding.UTF8.GetBytes(msg.ToJsonString()), WebSocketMessageType.Text, true, CancellationToken.None);

        public async Task Run()
        {
            var buffer = new byte[1 << 16];
            var text = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buffer, CancellationToken.None);
                if (r.MessageType == WebSocketMessageType.Close) break;
                text.Write(buffer, 0, r.Count);
                if (!r.EndOfMessage) continue;
                var raw = Encoding.UTF8.GetString(text.ToArray());
                text.SetLength(0);
                JsonObject reply;
                JsonNode? id = null;
                try
                {
                    var msg = JsonNode.Parse(raw)!.AsObject();
                    id = msg["id"]?.DeepClone();
                    reply = Handle(msg);
                }
                catch (Exception e)
                {
                    reply = new JsonObject { ["op"] = "error", ["message"] = e is PlcsimException ? e.Message : $"{e.GetType().Name}: {e.Message}" };
                    Console.WriteLine($"Error: {reply["message"]}");
                }
                reply["id"] = id;
                await Send(ws, reply);
            }
        }

        JsonObject Handle(JsonObject msg)
        {
            switch ((string?)msg["op"])
            {
                case "hello":
                    return backend.Hello();
                case "attach":
                    {
                        static Signal[] Sigs(JsonNode? n) => n?.AsArray().Select(s => new Signal((string)s!["tag"]!, (string?)s["type"] ?? "Real", (string?)s["role"])).ToArray() ?? [];
                        var instance = (string?)msg["instance"] ?? throw new PlcsimException("Which instance?");
                        var ts = (double?)msg["ts"] ?? throw new PlcsimException("No cycle time given.");
                        if (ts <= 0) throw new PlcsimException("The cycle time must be positive.");
                        var res = backend.Attach(instance, ts, Sigs(msg["write"]), Sigs(msg["read"]), (string?)msg["counter"] ?? "");
                        Console.WriteLine($"Attached to {instance}, Ts {ts} s");
                        return res;
                    }
                case "step":
                    {
                        var values = msg["values"]?.AsArray().Select(v => v is null ? double.NaN : (double)v).ToArray() ?? [];
                        var r = backend.Step(values, Math.Max(1, (int?)msg["cycles"] ?? 1));
                        var outv = new JsonArray();
                        foreach (var v in r.Values) outv.Add(double.IsFinite(v) ? JsonValue.Create(v) : null);
                        return new JsonObject { ["op"] = "stepped", ["values"] = outv, ["ran"] = r.Ran, ["late"] = r.Late, ["time"] = r.Time };
                    }
                case "detach":
                    backend.Detach();
                    return new JsonObject { ["op"] = "detached" };
                default:
                    throw new PlcsimException($"Unknown request '{msg["op"]}'.");
            }
        }
    }

    sealed class PlcsimException(string message) : Exception(message);

    /// <summary>A stand-in PLC: counts cycles and holds the valves at their manual values.</summary>
    sealed class MockBackend : IBackend
    {
        Signal[] write = [], read = [];
        double ts, time;
        readonly Dictionary<string, double> values = [];

        public JsonObject Hello() => new()
        {
            ["op"] = "hello", ["bridge"] = "loop-lab-plcsim", ["version"] = 1, ["api"] = "mock", ["mock"] = true,
            ["instances"] = new JsonArray(new JsonObject { ["name"] = "Mock PLC", ["state"] = "Run" }),
        };

        public JsonObject Attach(string instance, double ts, Signal[] write, Signal[] read, string counter)
        {
            (this.write, this.read, this.ts, time) = (write, read, ts, 0);
            return new JsonObject { ["op"] = "attached", ["instance"] = instance, ["cpu"] = "mock", ["state"] = "Run", ["missing"] = new JsonArray(), ["counter"] = true };
        }

        public StepResult Step(double[] v, int cycles)
        {
            for (var i = 0; i < write.Length && i < v.Length; i++) values[write[i].Role ?? write[i].Tag] = v[i];
            time += cycles * ts;
            double Get(string role) => values.TryGetValue(role, out var x) ? x : double.NaN;
            var outv = read.Select(s => s.Role == "cv" ? Get("manualOut") : s.Role == "cv2" ? Get("manualOut2") : double.NaN).ToArray();
            return new StepResult(outv, cycles, false, time);
        }

        public void Detach() { }
    }

    /// <summary>The real thing: one PLCSIM Advanced instance, stepped in virtual time.</summary>
    sealed class PlcsimBackend : IBackend
    {
        const int TimeoutMs = 30000;
        IInstance? plc;
        (string Tag, EPrimitiveDataType Type)[] write = [], read = [];
        string? counter;
        long ts, vt, target;
        long? savedMinCycle;

        static string ApiVersion() => $"{SimulationRuntimeManager.Version >> 16}.{SimulationRuntimeManager.Version & 0xFFFF}";

        public static string Describe()
        {
            var names = SimulationRuntimeManager.RegisteredInstanceInfo.Select(i => i.Name).ToArray();
            return $"PLCSIM Advanced API {ApiVersion()}; instances: {(names.Length == 0 ? "none yet (start one in the PLCSIM Advanced control panel)" : string.Join(", ", names))}";
        }

        public JsonObject Hello()
        {
            if (!SimulationRuntimeManager.IsRuntimeManagerAvailable)
                throw new PlcsimException("The PLCSIM Advanced runtime manager isn't running. Start S7-PLCSIM Advanced first.");
            var list = new JsonArray();
            foreach (var info in SimulationRuntimeManager.RegisteredInstanceInfo)
            {
                string state;
                try { state = SimulationRuntimeManager.CreateInterface(info.Name).OperatingState.ToString(); }
                catch { state = "?"; }
                list.Add(new JsonObject { ["name"] = info.Name, ["state"] = state });
            }
            return new JsonObject { ["op"] = "hello", ["bridge"] = "loop-lab-plcsim", ["version"] = 1, ["api"] = ApiVersion(), ["mock"] = false, ["instances"] = list };
        }

        static string Norm(string tag) => tag.Replace("\"", "").Trim().ToLowerInvariant();

        public JsonObject Attach(string instance, double tsSeconds, Signal[] w, Signal[] r, string counterTag)
        {
            Detach();
            var p = SimulationRuntimeManager.CreateInterface(instance);
            if (p.OperatingState == EOperatingState.Off) p.PowerOn(60000);
            if (p.OperatingState != EOperatingState.Run) p.Run(60000);
            if (p.OperatingState != EOperatingState.Run)
                throw new PlcsimException($"{instance} won't go to RUN (it is in {p.OperatingState}). Is a program downloaded?");
            p.UpdateTagList(ETagListDetails.DB, false);
            var tags = new Dictionary<string, STagInfo>();
            foreach (var t in p.TagInfos) tags.TryAdd(Norm(t.Name), t);
            var missing = new JsonArray();
            (string, EPrimitiveDataType)[] Resolve(Signal[] sigs) => sigs.Select(s =>
            {
                if (tags.TryGetValue(Norm(s.Tag), out var t)) return (t.Name, t.PrimitiveDataType);
                missing.Add(s.Tag);
                return (s.Tag, EPrimitiveDataType.Unspecific);
            }).ToArray();
            var wr = Resolve(w);
            var rd = Resolve(r);
            var hasCounter = tags.TryGetValue(Norm(counterTag), out var ct);
            var reply = new JsonObject
            {
                ["op"] = "attached", ["instance"] = instance, ["cpu"] = $"{p.CPUType} ({p.ArticleNumber})", ["state"] = p.OperatingState.ToString(),
                ["missing"] = missing, ["counter"] = hasCounter,
            };
            if (missing.Count > 0) return reply;

            (plc, write, read, counter) = (p, wr, rd, hasCounter ? ct.Name : null);
            ts = (long)Math.Round(tsSeconds * 1e9);
            // Sync points come at the end of each OB1 cycle: keep OB1 short next to the controller's cycle.
            try { savedMinCycle = p.OverwrittenMinimalCycleTime_ns; p.OverwrittenMinimalCycleTime_ns = Math.Min(ts / 20, 1_000_000); }
            catch { savedMinCycle = null; }
            p.RegisterOnSyncPointReachedEvent();
            p.OperatingMode = EOperatingMode.TimespanSynchronized_C;
            vt = 0;
            Align();
            return reply;
        }

        long RunFor(long ns)
        {
            plc!.StartProcessing(Math.Max(ns, 1000));
            var r = plc.WaitForOnSyncPointReachedEvent(TimeoutMs);
            if (r.ErrorCode != ERuntimeErrorCode.OK) throw new PlcsimException($"PLCSIM didn't reach its sync point: {r.ErrorCode}");
            return r.TimeSinceAnySyncPoint_ns;
        }

        int Count() => counter == null ? 0 : plc!.ReadInt32(counter);

        /// <summary>Put the step boundaries half a cycle away from OB30, so each step holds exactly one call.</summary>
        void Align()
        {
            if (counter != null)
            {
                var c0 = Count();
                var waited = 0;
                while (Count() == c0)
                {
                    if (++waited > 60) throw new PlcsimException("LoopLab_Cycle isn't being called: call it from a cyclic interrupt OB (OB30) with the controller's cycle time.");
                    vt += RunFor(ts / 20);
                }
            }
            vt += RunFor(ts / 2);
            target = vt;
        }

        public StepResult Step(double[] values, int cycles)
        {
            if (plc == null) throw new PlcsimException("Not attached to an instance.");
            for (var i = 0; i < write.Length && i < values.Length; i++) Write(write[i], values[i]);
            var c0 = Count();
            target += cycles * ts;
            vt += RunFor(target - vt);
            var late = false;
            if (counter != null)
            {
                // OB30 drifted past the boundary: run on until it has been called, then re-centre.
                var extra = 0;
                while (Count() - c0 < cycles && extra++ < 60) { vt += RunFor(ts / 20); late = true; }
                if (late) { vt += RunFor(ts / 2); target = vt; }
            }
            var ran = counter == null ? cycles : Count() - c0;
            return new StepResult(read.Select(Read).ToArray(), ran, late, vt / 1e9);
        }

        void Write((string Tag, EPrimitiveDataType Type) s, double v)
        {
            if (!double.IsFinite(v)) return;
            switch (s.Type)
            {
                case EPrimitiveDataType.Bool: plc!.WriteBool(s.Tag, v != 0); break;
                case EPrimitiveDataType.Int16: plc!.WriteInt16(s.Tag, (short)Math.Round(v)); break;
                case EPrimitiveDataType.Int32: plc!.WriteInt32(s.Tag, (int)Math.Round(v)); break;
                case EPrimitiveDataType.Double: plc!.WriteDouble(s.Tag, v); break;
                default: plc!.WriteFloat(s.Tag, (float)v); break;
            }
        }

        double Read((string Tag, EPrimitiveDataType Type) s) => s.Type switch
        {
            EPrimitiveDataType.Bool => plc!.ReadBool(s.Tag) ? 1 : 0,
            EPrimitiveDataType.Int16 => plc!.ReadInt16(s.Tag),
            EPrimitiveDataType.Int32 => plc!.ReadInt32(s.Tag),
            EPrimitiveDataType.Double => plc!.ReadDouble(s.Tag),
            _ => plc!.ReadFloat(s.Tag),
        };

        /// <summary>Hand the instance back running freely, as it was.</summary>
        public void Detach()
        {
            if (plc == null) return;
            var p = plc;
            plc = null;
            try { p.OperatingMode = EOperatingMode.Default; } catch { }
            try { p.UnregisterOnSyncPointReachedEvent(); } catch { }
            if (savedMinCycle is long m) try { p.OverwrittenMinimalCycleTime_ns = m; } catch { }
        }
    }
}
