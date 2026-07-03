---
title: "OpenSalles Overview"
summary: "What the project does, how the router works, and how AI providers are selected"
read_when:
  - Asking what OpenSalles can do after setup
  - Understanding the router, agents, and API wiring
---

# OpenSalles Overview

OpenSalles is a personal AI gateway and assistant platform. After it is set up, it can:

- receive and send messages across multiple channels
- route each conversation to the right agent
- run tool-enabled tasks through the local agent runtime
- expose a gateway API for other apps, scripts, and integrations
- use voice, canvas, browser, and device nodes when those features are enabled

## What it is capable of

In practice, a finished setup lets you:

- chat with the assistant from the CLI, web UI, or connected channels
- hand a message to a specific agent profile or workspace
- let the system choose a model automatically, or pick one yourself
- connect external systems through the HTTP API and WebSocket gateway
- keep one assistant instance per trusted boundary, instead of mixing users

## How the router works

The router is the control layer that decides where an incoming message goes.

It can route by:

- channel
- account
- sender or peer
- agent id
- provider
- model

That means you can keep the same assistant "shell" and swap the "motor" underneath it.

## How AI selection works

OpenSalles can use multiple AI providers inside the same installation. The selection path is:

1. pick an agent profile
2. resolve the provider for that profile
3. resolve the model for that provider
4. fall back to defaults if nothing is specified

For API callers, the gateway now accepts explicit routing hints so you can choose the AI directly. The HTTP layer supports `agentId`, `provider`, and `model`, and the request headers mirror those choices.

## How the API connection works

The gateway exposes the assistant through HTTP and WebSocket surfaces. External apps can:

- send messages into the gateway
- request a specific agent
- request a specific provider/model combo
- read back streamed responses

That gives you a clean integration path for dashboards, routers, mobile apps, scripts, or other services that need to talk to the assistant programmatically.

## Mental model

- OpenSalles is the shell
- agents are the personalities/workspaces
- providers are the AI backends
- models are the specific engines
- the gateway is the API surface that ties everything together
