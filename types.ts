import { AutomergeUrl } from "@automerge/automerge-repo"

export interface ImportedFile {
  name: string
  contentType: string
  executable: boolean
  contents: string | Uint8Array
}

export interface Folder {
  contentType: string
  name: string
  contents: FolderItem[]
}

export interface FolderItem {
  name: string
  automergeUrl: AutomergeUrl
}

