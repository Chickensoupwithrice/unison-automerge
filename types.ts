import { AutomergeUrl } from "@automerge/automerge-repo"

export interface File {
    name: string
    contentType: string
    executable: boolean
    contents: string | Uint8Array
}

export interface Folder {
    name: string
    contents: FolderItem[]
}

export interface FolderItem {
  name: string
  automergeUrl: AutomergeUrl
}

