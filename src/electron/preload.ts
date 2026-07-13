// ----- FreeShow -----
// Expose protected methods that allow the renderer process to use the ipcRenderer without exposing the entire object

import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ValidChannels } from "../types/Channels"

// const maxInterval: number = 500
// const useTimeout: ValidChannels[] = ["STAGE", "REMOTE", "CONTROLLER", "OUTPUT_STREAM"]
// let lastChannel: string = ""

// wait to log messages until after intial load is done
let appLoaded = false
// Verbose IPC tracing (TO ELECTRON / TO CLIENT) is opt-in to avoid flooding the console during normal dev.
// Enable by launching with the GOC_DEBUG_IPC=1 environment variable.
const LOG_MESSAGES: boolean = process.env.GOC_DEBUG_IPC === "1"
const filteredChannelsData: string[] = ["AUDIO_MAIN", "VISUALIZER_DATA", "STREAM", "BUFFER", "REQUEST_STREAM", "MAIN_TIME", "MAIN_SLIDE_VIDEO", "GET_THUMBNAIL", "ACTIVE_TIMERS", "RECEIVE_STREAM", "CHECK_RAM_USAGE", "TIMECODE_VALUE", "TIMECODE_AUDIO_DATA", "SPOTIFY_GET_STATE"]
const filteredChannels: ValidChannels[] = ["AUDIO"]

// FreeShow multiplexes many independent subscriptions over a few shared IPC channels (notably MAIN
// and OUTPUT). A single ipcRenderer channel can therefore legitimately have more than Node's default
// of 10 concurrent listeners - e.g. in the output window there is one OUTPUT listener per on-screen
// media item, which doubles while two slides overlap during a crossfade transition. These per-item
// listeners are removed on component destroy (see MediaItem.svelte / BackgroundMedia.svelte) and the
// global receivers are registered once per window, so this is expected concurrency, not a leak.
// Raise the cap to a bounded value (not 0/unlimited) so a genuine runaway leak would still warn.
ipcRenderer.setMaxListeners(100)

const storedReceivers: { [key: string]: (e: IpcRendererEvent, args: any) => void } = {}

contextBridge.exposeInMainWorld("api", {
    send: (channel: ValidChannels, data: any, id?: string) => {
        if (LOG_MESSAGES && appLoaded && !filteredChannels.includes(channel) && !filteredChannelsData.includes(data?.channel)) console.info("TO ELECTRON [" + channel + "]: ", data)
        // if (useTimeout.includes(channel) && data.channel === lastChannel && data.id) return

        ipcRenderer.send(channel, data, id)

        // lastChannel = data.channel
        // setTimeout(() => (lastChannel = ""), maxInterval)
    },
    receive: (channel: ValidChannels, func: any, id?: string) => {
        const receiver = (_e: IpcRendererEvent, args: any, listenedId?: string) => {
            if (!appLoaded && channel === "MAIN" && args?.channel === "SHOWS") setTimeout(() => (appLoaded = true), 5000)
            if (LOG_MESSAGES && appLoaded && !filteredChannels.includes(channel) && !filteredChannelsData.includes(args?.channel)) console.info("TO CLIENT [" + channel + "]: ", args)

            func(args, listenedId)
        }

        if (id && storedReceivers[id]) {
            ipcRenderer.removeListener(channel, storedReceivers[id])
        }

        ipcRenderer.on(channel, receiver)
        if (id) storedReceivers[id] = receiver
    },
    removeListener: (channel: ValidChannels, id: string) => {
        if (!storedReceivers[id]) return

        ipcRenderer.removeListener(channel, storedReceivers[id])
        delete storedReceivers[id]
    },
    getListeners: () => {
        return ipcRenderer.eventNames().map((channel) => [channel.toString(), ipcRenderer.listenerCount(channel)])
    },
    // https://www.electronjs.org/blog/electron-32-0#breaking-changes
    showFilePath(file: File) {
        return webUtils.getPathForFile(file)
    }
})
