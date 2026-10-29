# Loop Lab PLCSIM bridge

Runs Loop Lab's test scripts against your controller as compiled SCL on a virtual
S7-1500 in S7-PLCSIM Advanced. The plant stays in the browser. The bridge sits on the
PC that runs PLCSIM and steps the virtual PLC one OB30 cycle at a time, so the PLC's
clock only moves when the plant's does. That makes the run exact however long each
round trip takes, and the PLC trace can be laid over the browser's.

```
Loop Lab page ──WebSocket (ws://localhost:8765)──▶ bridge ──PLCSIM Advanced API──▶ virtual S7-1500
   plant, test script, scoring                          write readings, run one cycle,       "LoopLab_Cycle" in OB30
                                                        read valve signals
```

## What you need

- S7-PLCSIM Advanced (built against API 8.0, i.e. V8; others with `-p:PlcsimApi=…`)
- TIA Portal to compile and download the kit
- the .NET 8 SDK

## On the PLC side

1. In Loop Lab, open a process, set up the controller, go to **Automation**, and download
   the kit (`LoopLab_<loop>_<kind>.scl`).
2. In TIA Portal, on an S7-1500 CPU that your PLCSIM Advanced version supports: go to
   **External source files > Add new external file**, pick the kit, and run
   **Generate blocks from source**. This creates:
   - `"LoopLab_IO"`, the signals the bridge writes and reads
   - the controller's function blocks and their instance DBs, with the start-up tuning
   - `"LoopLab_Cycle"`, the call site
3. Add a **Cyclic interrupt** OB (OB30). Set its cycle time to the controller's cycle
   time (the kit's header gives it) and call `"LoopLab_Cycle"()` from it.
4. Compile, then download to a PLCSIM Advanced instance.

## Run the bridge

```bash
cd tools/plcsim-bridge
dotnet run -c Release
```

| Option | Default | What it does |
|---|---|---|
| `-port <n>` | 8765 | WebSocket port on localhost |
| `-mock` | off | No PLCSIM: a stand-in PLC that holds the valves at their manual values. Use it to check the connection. |
| `-origin <url>` | this site and `localhost` | Also accept pages from another origin |

Back in Loop Lab, click **Connect to the bridge**, pick the instance and a test, then run.
The page brings the PLC to the plant's steady state in manual first: five cycles, so every
block tracks, then switches to auto. When the run ends, the bridge hands the instance
back running freely.

## How a step works

- **Attach.** The bridge switches the instance to *time span synchronized* mode. It finds
  OB30's phase from `"LoopLab_IO".Cycles` and puts the step boundaries half a cycle away
  from it.
- **Step.** The bridge does four things:
  1. writes the readings into `"LoopLab_IO"`;
  2. runs one cycle of virtual time, correcting for drift;
  3. checks that `Cycles` went up by exactly one, and if OB30 was late, runs on until it
     has been called and then re-centres;
  4. reads the outputs back.
- **Detach.** The bridge restores the default operating mode.

The protocol (JSON over the WebSocket) is described at the top of `lib/loop-lab/plcsim.ts`.

## Things that go wrong

- **"doesn't have …"**: the instance's program is from another kit. Download the kit for
  the controller you have set up, then generate, compile and download it again.
- **"LoopLab_Cycle isn't being called"**: there is no OB30, or OB30 doesn't call the FC.
- **Results differ from the browser**: you changed settings after downloading the kit, or
  your code isn't the same algorithm. The PLC works in 32-bit REAL, so expect small
  differences (hundredths of a %), not large ones.
- **The page can't connect**: Chrome may ask whether the site may reach devices on your
  local network. Allow it.
