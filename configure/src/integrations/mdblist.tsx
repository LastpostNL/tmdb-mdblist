import { useState } from 'react'
import { useConfig } from '@/contexts/ConfigContext'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function MDBListIntegration() {
  const { config, setConfig } = useConfig()
  const [tokenInput, setTokenInput] = useState(config.mdblistUserToken || '')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSaveToken = async () => {
    setStatus('loading')
    setError(null)

    try {
      const res = await fetch(`/mdblist/lists/user?apikey=${tokenInput}`)
      if (!res.ok) throw new Error('Ophalen van lijsten mislukt')

      const lists = await res.json()

      const newLists: any = { movie: {}, series: {} }

      for (const list of lists) {
        const section = list.mediatype === 'movie' ? 'movie' : 'series'
        newLists[section][list.id] = {
          name: list.name,
          enabled: true,
          home: false
        }
      }

      setConfig({
        ...config,
        mdblistUserToken: tokenInput,
        lists: {
          ...config.lists,
          mdblist: newLists
        }
      })

      setStatus('success')
    } catch (err: any) {
      console.error(err)
      setStatus('error')
      setError(err.message)
    }
  }

  return (
    <Card className="p-4 space-y-4">
      <h2 className="text-xl font-bold">MDBList</h2>
      <p>Voer je persoonlijke MDBList API key in om je lijsten te laden.</p>
      <Input
        type="text"
        placeholder="MDBList API Key"
        value={tokenInput}
        onChange={(e) => setTokenInput(e.target.value)}
      />
      <Button onClick={handleSaveToken} disabled={status === 'loading'}>
        {status === 'loading' ? 'Laden...' : 'Opslaan en lijsten ophalen'}
      </Button>

      {status === 'success' && (
        <p className="text-green-600">Lijsten succesvol opgehaald en opgeslagen!</p>
      )}
      {status === 'error' && (
        <p className="text-red-600">Fout: {error}</p>
      )}

      {config.mdblistUserToken && status !== 'loading' && (
        <p className="text-sm text-gray-500">Je bent ingelogd bij MDBList.</p>
      )}
    </Card>
  )
}
