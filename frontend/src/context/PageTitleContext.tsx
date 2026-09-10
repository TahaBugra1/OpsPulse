import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface PageTitleContextValue {
  title: string
  setTitle: (t: string) => void
}

const PageTitleContext = createContext<PageTitleContextValue | null>(null)

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('')
  return <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>
}

// A page calls this once in its body to declare the header title.
export function usePageTitle(title: string) {
  const ctx = useContext(PageTitleContext)
  useEffect(() => {
    ctx?.setTitle(title)
  }, [ctx, title])
}

// The header bar reads the current title.
export function usePageTitleValue(): string {
  return useContext(PageTitleContext)?.title ?? ''
}
