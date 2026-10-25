import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createDemoDocumentRepository, serverDocumentRepository } from './documentRepo'
import { createDocumentController } from './documentController'
import type { CenterDocumentView } from './CenterDocuments'

export function useCenterDocuments(preview: boolean, enabled: boolean): CenterDocumentView {
  const repository = useMemo(() => preview ? createDemoDocumentRepository(window.localStorage) : serverDocumentRepository, [preview])
  const controller = useMemo(() => createDocumentController(enabled ? repository : {
    list: async () => [],
    mutate: async () => { throw new Error('로그인 후 문서 저장소를 사용할 수 있습니다.') },
  }), [repository, enabled])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  useEffect(() => {
    if (enabled) void controller.reload()
    return controller.reset
  }, [controller, enabled])
  return { ...snapshot, repository, reload: controller.reload, saved: controller.saved }
}
