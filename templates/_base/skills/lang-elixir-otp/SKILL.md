---
name: lang-elixir-otp
description: Elixir/OTP patterns for stateful agents — GenServer for state, Supervisor trees for fault tolerance, Phoenix Channels for pub/sub mapped to the workbench message bus
domain: language
type: cross-cutting
triggers:
  - "elixir"
  - "OTP"
  - "GenServer"
  - "supervisor"
  - "phoenix channels"
  - "actor model"
  - "beam"
  - "erlang"
---

# Elixir / OTP

## When to use

Use this skill when building a workbench project as an Elixir OTP application — typically an `agent` or `multi-agent` project type where fault tolerance and stateful processes are central concerns. Elixir's actor model maps cleanly onto the workbench's agent and message bus concepts: GenServers hold agent state, Supervisors restart crashed agents, and Phoenix Channels provide the pub/sub backbone that mirrors `bus_publish`/`bus_read`.

## Prerequisites

- Elixir 1.16+ with Erlang/OTP 26+
- `mix` available in the container (add `elixir:1.16-alpine` as a Docker stage if needed)
- Phoenix framework if using Channels: `mix phx.new`
- Workbench MCP server running for RAG/memory calls (`make up`)

## mix.exs Setup

```elixir
defmodule MyAgent.MixProject do
  use Mix.Project

  def project do
    [
      app: :my_agent,
      version: "0.1.0",
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {MyAgent.Application, []}
    ]
  end

  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"},
      {:req, "~> 0.5"},          # HTTP client for workbench API calls
      {:jason, "~> 1.4"},
      {:telemetry, "~> 1.2"}
    ]
  end
end
```

## GenServer Template

A GenServer is the building block for any stateful process. Use it for: agent memory, task queues, rate limiters, connection pools.

```elixir
# lib/my_agent/agent_server.ex
defmodule MyAgent.AgentServer do
  use GenServer
  require Logger

  # ---- Public API (client side) ----

  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: via(name))
  end

  def get_state(name), do: GenServer.call(via(name), :get_state)

  def process(name, input),
    do: GenServer.call(via(name), {:process, input}, 30_000)

  def update_memory(name, key, value),
    do: GenServer.cast(via(name), {:update_memory, key, value})

  # ---- Callbacks (server side) ----

  @impl true
  def init(opts) do
    project = Keyword.fetch!(opts, :project)
    Logger.info("AgentServer starting for project=#{project}")

    state = %{
      project: project,
      memory: %{},
      iteration: 0
    }

    # Async init: send ourselves a message to do expensive setup after init returns
    send(self(), :load_memories)

    {:ok, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, state, state}
  end

  @impl true
  def handle_call({:process, input}, _from, state) do
    case do_process(input, state) do
      {:ok, result, new_state} ->
        {:reply, {:ok, result}, new_state}
      {:error, reason} ->
        Logger.warning("Processing failed: #{inspect(reason)}")
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_cast({:update_memory, key, value}, state) do
    {:noreply, put_in(state, [:memory, key], value)}
  end

  @impl true
  def handle_info(:load_memories, state) do
    case MyAgent.WorkbenchClient.recall(state.project, "agent_state") do
      {:ok, saved} ->
        {:noreply, Map.merge(state, Jason.decode!(saved, keys: :atoms))}
      {:error, _} ->
        {:noreply, state}
    end
  end

  @impl true
  def terminate(reason, state) do
    Logger.info("AgentServer terminating: #{inspect(reason)}")
    # Best-effort save on shutdown
    MyAgent.WorkbenchClient.remember(
      state.project,
      "agent_state",
      Jason.encode!(state.memory)
    )
    :ok
  end

  # ---- Private ----

  defp via(name), do: {:via, Registry, {MyAgent.Registry, name}}

  defp do_process(input, state) do
    new_state = %{state | iteration: state.iteration + 1}
    {:ok, %{result: "processed #{input}", iteration: new_state.iteration}, new_state}
  end
end
```

## Supervisor Tree Template

Supervisors define fault tolerance policy. Use `one_for_one` when processes are independent, `rest_for_one` when they form a pipeline.

```elixir
# lib/my_agent/application.ex
defmodule MyAgent.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Registry for dynamic GenServer lookup by name
      {Registry, keys: :unique, name: MyAgent.Registry},

      # Supervisor for dynamically spawned agents
      {DynamicSupervisor, name: MyAgent.AgentSupervisor, strategy: :one_for_one},

      # Always-on infrastructure
      {Phoenix.PubSub, name: MyAgent.PubSub},
      MyAgent.BusPoller
    ]

    opts = [strategy: :one_for_one, name: MyAgent.MainSupervisor]
    Supervisor.start_link(children, opts)
  end
end

# lib/my_agent/agent_manager.ex — spawn and stop agents dynamically
defmodule MyAgent.AgentManager do
  def start_agent(project_name) do
    spec = {MyAgent.AgentServer, name: project_name, project: project_name}
    DynamicSupervisor.start_child(MyAgent.AgentSupervisor, spec)
  end

  def stop_agent(project_name) do
    case Registry.lookup(MyAgent.Registry, project_name) do
      [{pid, _}] -> DynamicSupervisor.terminate_child(MyAgent.AgentSupervisor, pid)
      [] -> {:error, :not_found}
    end
  end
end
```

## Phoenix Channels: Pub/Sub Mapped to Workbench Message Bus

Phoenix Channels provide real-time pub/sub. Map them to the workbench bus: publish on a channel = `bus_publish`, subscribe = `bus_read` (streaming).

```elixir
# lib/my_agent_web/channels/bus_channel.ex
defmodule MyAgentWeb.BusChannel do
  use Phoenix.Channel
  require Logger

  # Client joins "bus:<project>:<channel>"
  def join("bus:" <> rest, _params, socket) do
    [project, channel] = String.split(rest, ":", parts: 2)
    socket = assign(socket, project: project, channel: channel)
    Logger.info("Client joined bus channel=#{channel} project=#{project}")
    {:ok, socket}
  end

  # Receive message from client → publish to workbench bus + broadcast to channel members
  def handle_in("publish", %{"payload" => payload}, socket) do
    %{project: project, channel: channel} = socket.assigns

    # Forward to workbench message bus
    case MyAgent.WorkbenchClient.publish(project, channel, payload) do
      {:ok, _} ->
        broadcast!(socket, "message", %{channel: channel, payload: payload})
        {:noreply, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end
end

# lib/my_agent/bus_poller.ex — poll workbench bus and broadcast to Phoenix PubSub
defmodule MyAgent.BusPoller do
  use GenServer

  @poll_interval_ms 2_000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  @impl true
  def init(state) do
    schedule_poll()
    {:ok, state}
  end

  @impl true
  def handle_info(:poll, state) do
    # Poll all active channels from the workbench bus
    active_channels = Map.keys(state)

    for {project, channels} <- active_channels,
        channel <- channels do
      case MyAgent.WorkbenchClient.read_bus(project, channel) do
        {:ok, %{"messages" => msgs}} when msgs != [] ->
          Enum.each(msgs, fn msg ->
            Phoenix.PubSub.broadcast(
              MyAgent.PubSub,
              "bus:#{project}:#{channel}",
              {:bus_message, msg}
            )
          end)
        _ -> :ok
      end
    end

    schedule_poll()
    {:noreply, state}
  end

  defp schedule_poll, do: Process.send_after(self(), :poll, @poll_interval_ms)
end
```

## Workbench HTTP Client

```elixir
# lib/my_agent/workbench_client.ex
defmodule MyAgent.WorkbenchClient do
  @base_url System.get_env("MCP_SERVER_URL", "http://mcp-server:3100")

  def query(project, q, limit \\ 5) do
    Req.post("#{@base_url}/projects/#{project}/query",
      json: %{query: q, limit: limit}
    )
    |> handle_response()
  end

  def remember(project, key, value) do
    Req.post("#{@base_url}/projects/#{project}/memories",
      json: %{key: key, value: value}
    )
    |> handle_response()
  end

  def recall(project, key) do
    Req.get("#{@base_url}/projects/#{project}/memories/#{URI.encode(key)}")
    |> handle_response()
  end

  def publish(project, channel, payload) do
    Req.post("#{@base_url}/projects/#{project}/bus/publish",
      json: %{channel: channel, payload: payload}
    )
    |> handle_response()
  end

  def read_bus(project, channel, limit \\ 10) do
    Req.get("#{@base_url}/projects/#{project}/bus/#{channel}?limit=#{limit}")
    |> handle_response()
  end

  defp handle_response({:ok, %{status: status, body: body}}) when status in 200..299,
    do: {:ok, body}
  defp handle_response({:ok, %{status: status, body: body}}),
    do: {:error, "HTTP #{status}: #{inspect(body)}"}
  defp handle_response({:error, reason}),
    do: {:error, reason}
end
```

## Task for Async Work

Use `Task.async`/`Task.await` for one-shot concurrent operations, `Task.Supervisor` for fire-and-forget work:

```elixir
# Parallel calls to workbench
results =
  [:rag, :memory, :bus]
  |> Enum.map(fn source ->
    Task.async(fn -> fetch_from(source, project, query) end)
  end)
  |> Task.await_many(10_000)

# Fire-and-forget with supervision
Task.Supervisor.start_child(MyAgent.TaskSupervisor, fn ->
  MyAgent.WorkbenchClient.remember(project, "last_run", DateTime.utc_now() |> to_string())
end)
```

## Checklist

- [ ] Supervision tree defined in `Application.start/2` — no bare `GenServer.start_link` calls outside a supervisor
- [ ] GenServer processes registered via `Registry` (named lookup without hardcoded PIDs)
- [ ] `terminate/2` callback saves critical state before shutdown
- [ ] Expensive init work deferred with `send(self(), :load_data)` — not in `init/1` directly
- [ ] Workbench client reads `MCP_SERVER_URL` from env, defaults to `http://mcp-server:3100`
- [ ] Phoenix Channels `join/3` validates params before accepting connection
- [ ] `Task.Supervisor` used for fire-and-forget tasks, not bare `Task.start`

## Files involved

| File | Action |
|------|--------|
| `mix.exs` | Create: OTP app config, deps (req, jason, phoenix_pubsub) |
| `lib/<app>/application.ex` | Create: supervision tree, Registry, DynamicSupervisor |
| `lib/<app>/agent_server.ex` | Create: GenServer template |
| `lib/<app>/agent_manager.ex` | Create: dynamic agent spawn/stop |
| `lib/<app>/workbench_client.ex` | Create: HTTP client for MCP server |
| `lib/<app>_web/channels/bus_channel.ex` | Create: Phoenix Channel for bus pub/sub |
| `lib/<app>/bus_poller.ex` | Create: GenServer polling workbench bus |

## Common mistakes

**Doing I/O in `init/1`** — `init/1` must return quickly or the starting process blocks. HTTP calls, DB queries, and file reads in `init/1` cause cascading timeout failures during application startup. Use `send(self(), :initialize)` and handle the work in `handle_info/2`.

**Using bare `Task.start` for critical async work** — tasks started without a `Task.Supervisor` are not restarted on failure and can silently drop work. Use `Task.Supervisor.start_child/2` for anything that must complete.

**Calling `GenServer.call` from within a `handle_call`** — if process A calls B which calls A, you get a deadlock. Use `GenServer.cast` or `send` for cross-process communication inside callbacks, then let the caller wait for an async reply.

**Not using `Registry` for named process lookup** — storing PIDs in module attributes or ETS is fragile: the PID changes each time the process restarts. `Registry` with `:via` tuples gives crash-safe named lookup automatically.

**Ignoring backpressure on the bus poller** — if the workbench bus accumulates messages faster than the poller processes them, the GenServer mailbox grows unbounded. Add a `limit` parameter to bus reads and consider a `handle_continue` flow for batch processing.
