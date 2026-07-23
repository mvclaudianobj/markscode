import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'
import { createMemo, createSignal } from 'solid-js'
import { DialogSelect, type DialogSelectOption } from '../ui/dialog-select'
import { DialogPrompt } from '../ui/dialog-prompt'
import { DialogConfirm } from '../ui/dialog-confirm'
import { DialogAlert } from '../ui/dialog-alert'
import { useDialog } from '../ui/dialog'
import { listRemoteSSHProfiles, replaceRemoteSSHProfiles } from '@/remote/profile-repo'

const id = 'internal:dialog-remote-profile'

type RemoteSSHProfile = {
  id: string
  name: string
  type?: RemoteProfileType
  host: string
  user: string
  port: number
  transport?: 'http' | 'https'
  identity_file?: string
  key_name?: string
  host_alias?: string
  credential_ref?: string
  auth_method?: string | null
  metadata?: string | null
  created_at: string
  updated_at: string
  protocol?: string
  master_key_ref?: string
  encrypted_password?: string
  pki_enabled?: number
}

type RemoteProfileType = 'ssh' | 'winrm' | 'powershell' | 'whm'

type DialogStep =
  | 'menu'
  | 'create-ssh-name' | 'create-ssh-host' | 'create-ssh-user' | 'create-ssh-port' | 'create-ssh-auth' | 'create-ssh-auth-value' | 'create-ssh-review'
  | 'create-winrm-name' | 'create-winrm-host' | 'create-winrm-user' | 'create-winrm-port' | 'create-winrm-transport' | 'create-winrm-auth' | 'create-winrm-auth-value' | 'create-winrm-review'
  | 'create-powershell-name' | 'create-powershell-host' | 'create-powershell-user' | 'create-powershell-port' | 'create-powershell-transport' | 'create-powershell-auth' | 'create-powershell-auth-value' | 'create-powershell-review'
  | 'create-whm-name' | 'create-whm-host' | 'create-whm-user' | 'create-whm-port' | 'create-whm-auth' | 'create-whm-auth-value' | 'create-whm-review'
  | 'select-for-use' | 'select-for-edit' | 'select-for-delete' | 'select-for-export' | 'select-for-assign-master' | 'select-for-deploy-command'
  | 'edit-name' | 'edit-host' | 'edit-user' | 'edit-port'
  | 'delete-confirm'
  | 'import-json-input' | 'import-json-confirm'

type AuthChoice = 'master' | 'identity' | 'credential' | 'password' | 'master_password' | 'skip'

let pluginApi: TuiPluginApi | null = null

export function registerPluginAPI(api: TuiPluginApi) {
  pluginApi = api
}

function getKV(key: string): unknown {
  return pluginApi?.kv.get(key, '')
}

function setKV(key: string, value: unknown) {
  pluginApi?.kv.set(key, value)
}

const MARKSCODE_MASTER_KEY_NAME = 'marks-key-mestra'
const MARKSCODE_MASTER_IDENTITY_FILE = '~/.ssh/marks-key-mestra'
const expandMasterKeyPath = (value: string) => {
  if (!value.startsWith('~/')) return value
  const home = process.env.HOME || ''
  return home ? home + '/' + value.slice(2) : value
}
const runMasterKeyCommand = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (exitCode !== 0) throw new Error((stderr || stdout || cmd[0] + ' falhou').trim())
  return stdout.trim()
}
const ensureMarksMasterKey = async () => {
  const privateKey = expandMasterKeyPath(MARKSCODE_MASTER_IDENTITY_FILE)
  const publicKey = privateKey + '.pub'
  const sshDir = privateKey.slice(0, privateKey.lastIndexOf('/'))
  await runMasterKeyCommand(['mkdir', '-p', sshDir])
  await runMasterKeyCommand(['chmod', '700', sshDir])
  const existed = await Bun.file(privateKey).exists()
  if (!existed) await runMasterKeyCommand(['ssh-keygen', '-t', 'ed25519', '-N', '', '-C', MARKSCODE_MASTER_KEY_NAME, '-f', privateKey])
  await runMasterKeyCommand(['chmod', '600', privateKey])
  if (!(await Bun.file(publicKey).exists())) await Bun.write(publicKey, (await runMasterKeyCommand(['ssh-keygen', '-y', '-f', privateKey])) + '\n')
  await runMasterKeyCommand(['chmod', '644', publicKey])
  const fingerprint = await runMasterKeyCommand(['ssh-keygen', '-lf', publicKey])
  setKV('remote_ssh_master_key_name', MARKSCODE_MASTER_KEY_NAME)
  setKV('remote_ssh_master_identity_file', MARKSCODE_MASTER_IDENTITY_FILE)
  return [
    existed ? 'Chave privada existente validada; não foi sobrescrita.' : 'Chave mestra criada com sucesso.',
    'Nome: ' + MARKSCODE_MASTER_KEY_NAME,
    'Privada: ' + MARKSCODE_MASTER_IDENTITY_FILE,
    'Pública: ' + MARKSCODE_MASTER_IDENTITY_FILE + '.pub',
    'Fingerprint: ' + fingerprint,
  ].join('\n')
}
const normalizeType = (value: unknown): RemoteProfileType => value === 'winrm' || value === 'powershell' || value === 'whm' ? value : 'ssh'
const defaultPort = (type: RemoteProfileType) => type === 'whm' ? 2087 : type === 'winrm' || type === 'powershell' ? 5986 : 22
const defaultTransport = (type: RemoteProfileType) => type === 'whm' || type === 'winrm' || type === 'powershell' ? 'https' : undefined
const isWindowsType = (type: RemoteProfileType) => type === 'winrm' || type === 'powershell'
const labelFor = (type: RemoteProfileType) => type === 'ssh' ? 'SSH/Linux' : type === 'winrm' ? 'WinRM/Windows' : type === 'powershell' ? 'PowerShell/Windows' : 'WHM/cPanel'
const encodeCredential = (plaintext: string) => `encrypted:${Buffer.from(plaintext, 'utf-8').toString('base64')}`

const clean = (value: unknown) => String(value ?? '').trim()

const validateRequired = (label: string, value: unknown) => {
  const text = clean(value)
  if (!text) throw new Error(label + ' é obrigatório')
  return text
}

const validatePort = (value: unknown, fallback: number) => {
  const text = clean(value) || String(fallback)
  const port = Number.parseInt(text, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535 || String(port) !== text) throw new Error('Porta deve ser numérica entre 1 e 65535')
  return port
}

const rejectPlaintextSecretFields = (data: Record<string, unknown>) => {
  const found = ['password', 'senha', 'plain_password', 'plaintext_password'].filter((key) => data[key] !== undefined && data[key] !== null && clean(data[key]) !== '')
  if (found.length) throw new Error('Perfil remoto não pode salvar senha em texto puro: ' + found.join(', '))
}

const validateCommandTarget = (profile: RemoteSSHProfile) => {
  const user = validateRequired('Usuário', profile.user)
  const host = validateRequired('Host', profile.host)
  const port = validatePort(profile.port || 22, 22)
  if (!/^[A-Za-z0-9._-]+$/.test(user)) throw new Error('Usuário contém caracteres inválidos para comando copyable')
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new Error('Host contém caracteres inválidos para comando copyable')
  return { user, host, port }
}

const masterKeyDeployCommandText = (profile: RemoteSSHProfile) => {
  const target = validateCommandTarget(profile)
  return [
    'ssh-copy-id -i ~/.ssh/marks-key-mestra.pub -p ' + String(target.port) + ' ' + target.user + '@' + target.host,
    '',
    'Fallback:',
    "cat ~/.ssh/marks-key-mestra.pub | ssh -p " + String(target.port) + ' ' + target.user + '@' + target.host + " 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'",
    '',
    'Senha salva disponível internamente para bootstrap/deploy: ' + (profile.encrypted_password ? 'sim (segredo não exibido)' : 'não'),
  ].join('\n')
}

function generateID(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return slug || String(Date.now())
}

function normalizeProfile(profile: Partial<RemoteSSHProfile> & { name: string; host: string; user: string }): RemoteSSHProfile {
  const now = new Date().toISOString()
  const type = normalizeType(profile.type)
  return {
    id: profile.id || generateID(profile.name),
    name: profile.name,
    type,
    host: profile.host,
    user: profile.user,
    port: validatePort(profile.port || defaultPort(type), defaultPort(type)),
    transport: profile.transport || defaultTransport(type),
    identity_file: profile.identity_file || undefined,
    key_name: profile.key_name || undefined,
    host_alias: profile.host_alias || undefined,
    credential_ref: profile.credential_ref || undefined,
    auth_method: profile.auth_method || (profile.credential_ref ? 'credential_ref' : profile.identity_file || profile.key_name ? 'key' : undefined),
    metadata: profile.metadata || undefined,
    protocol: profile.protocol || type,
    master_key_ref: profile.master_key_ref || undefined,
    encrypted_password: profile.encrypted_password || undefined,
    pki_enabled: profile.pki_enabled ? 1 : 0,
    created_at: profile.created_at || now,
    updated_at: now,
  }
}

function loadProfiles(): RemoteSSHProfile[] {
  try {
    const dbProfiles = listRemoteSSHProfiles().map((profile) => ({
      id: profile.id,
      name: profile.name,
      type: normalizeType(profile.type),
      host: profile.host,
      user: profile.user,
      port: profile.port,
      transport: profile.transport === 'http' ? 'http' as const : profile.transport === 'https' ? 'https' as const : undefined,
      identity_file: profile.identity_file || undefined,
      key_name: profile.key_name || undefined,
      host_alias: profile.host_alias || undefined,
      credential_ref: profile.credential_ref || undefined,
      auth_method: profile.auth_method || undefined,
      metadata: profile.metadata || undefined,
      protocol: profile.protocol || undefined,
      master_key_ref: profile.master_key_ref || undefined,
      encrypted_password: profile.encrypted_password || undefined,
      pki_enabled: profile.pki_enabled ? 1 : 0,
      created_at: new Date(profile.time_created).toISOString(),
      updated_at: new Date(profile.time_updated).toISOString(),
    }))
    if (dbProfiles.length) return dbProfiles
  } catch {}
  try {
    const raw = getKV('remote_ssh_profiles')
    if (Array.isArray(raw)) return raw as RemoteSSHProfile[]
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed as RemoteSSHProfile[] : []
    }
    return []
  } catch {
    return []
  }
}

const dbWarning = (error: unknown) =>
  'remote_ssh_profiles_db_warning: Perfil salvo em fallback de sessão; DB indisponível (' + (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 180) + ')'

function saveProfiles(profiles: RemoteSSHProfile[]) {
  const sorted = profiles.toSorted((a, b) => a.name.localeCompare(b.name))
  const warning = (() => {
    try {
      replaceRemoteSSHProfiles(sorted.map((profile) => ({
        id: profile.id,
        account_id: null,
        org_id: null,
        name: profile.name,
        type: profile.type || 'ssh',
        host: profile.host,
        user: profile.user,
        port: profile.port,
        transport: profile.transport || null,
        identity_file: profile.identity_file || null,
        key_name: profile.key_name || null,
        host_alias: profile.host_alias || null,
        credential_ref: profile.credential_ref || null,
        auth_method: profile.auth_method || null,
        protocol: profile.protocol || profile.type || 'ssh',
        master_key_ref: profile.master_key_ref || null,
        encrypted_password: profile.encrypted_password || null,
        pki_enabled: profile.pki_enabled ? 1 : 0,
        metadata: profile.metadata || null,
      })))
      return undefined
    } catch (error) {
      return dbWarning(error)
    }
  })()
  setKV('remote_ssh_profiles', sorted)
  setKV('remote_ssh_profiles_db_warning', warning || '')
  setKV('remote_ssh_profile_names', sorted.map((profile) => profile.name))
  setKV('remote_ssh_profile_aliases', sorted.flatMap((profile) => [profile.name, profile.host_alias, profile.host].filter(Boolean)))
  setKV('remote_ssh_profiles_registry', sorted.map((profile) => ({ id: profile.id, name: profile.name, type: profile.type || 'ssh', protocol: profile.protocol || profile.type || 'ssh', host: profile.host, user: profile.user, port: profile.port, transport: profile.transport, host_alias: profile.host_alias, key_name: profile.key_name, credential_ref: profile.credential_ref ? '***ref***' : undefined, auth_method: profile.auth_method, password_saved: profile.encrypted_password ? 'yes' : 'no', master_key_ref: profile.master_key_ref, pki_enabled: profile.pki_enabled ? 'yes' : 'no' })))
  return warning
}

const safeJSON = (profile: RemoteSSHProfile) => JSON.stringify({
  id: profile.id,
  name: profile.name,
  type: profile.type || 'ssh',
  host: profile.host,
  user: profile.user,
  port: profile.port,
  transport: profile.transport,
  identity_file: profile.identity_file,
  key_name: profile.key_name,
  host_alias: profile.host_alias,
  credential_ref: profile.credential_ref ? '***ref***' : undefined,
  auth_method: profile.auth_method || undefined,
  master_key_ref: profile.master_key_ref,
  password_saved: profile.encrypted_password ? 'yes' : 'no',
  pki_enabled: profile.pki_enabled ? 'yes' : 'no',
}, null, 2)

function View(_props: { api: TuiPluginApi; session_id: string }) {
  const dialog = useDialog()
  const theme = () => _props.api.theme.current
  const [step, setStep] = createSignal<DialogStep>('menu')

  const [draftName, setDraftName] = createSignal('')
  const [draftHost, setDraftHost] = createSignal('')
  const [draftUser, setDraftUser] = createSignal('root')
  const [draftPort, setDraftPort] = createSignal('22')
  const [draftKind, setDraftKind] = createSignal<RemoteProfileType>('ssh')
  const [draftTransport, setDraftTransport] = createSignal<'http' | 'https' | ''>('')
  const [draftAuth, setDraftAuth] = createSignal<AuthChoice>('skip')
  const [draftAuthValue, setDraftAuthValue] = createSignal('')

  const [editProfileId, setEditProfileId] = createSignal('')
  const [importJSON, setImportJSON] = createSignal('')
  const [profilesVersion, setProfilesVersion] = createSignal(0)

  const refreshProfiles = () => setProfilesVersion((version) => version + 1)
  const profiles = createMemo(() => {
    profilesVersion()
    return loadProfiles()
  })

  const profileOptions = createMemo((): DialogSelectOption<string>[] => profiles().map((p) => ({
    title: String(p.name),
    value: p.id,
    description: String(p.user) + '@' + String(p.host) + ':' + String(p.port) + ' [' + String(p.type || 'ssh') + ']',
    details: ['auth: ' + String(p.auth_method || '-'), 'key/ref: ' + String(p.key_name || p.identity_file || p.credential_ref || '-')],
  })))

  const findProfile = (profileId: string): RemoteSSHProfile | undefined => profiles().find((profile) => profile.id === profileId)

  const showAlert = (title: string, message: string, onClose?: () => void) => {
    dialog.replace(
      () => <DialogAlert title={title} message={message} onConfirm={() => { onClose?.() }} />,
      onClose,
    )
  }

  const buildDraftProfile = (kind: RemoteProfileType) => {
    const deployMasterKey = draftAuth() === 'master' || draftAuth() === 'master_password'
    return normalizeProfile({
    id: generateID(validateRequired('Nome', draftName())),
    name: validateRequired('Nome', draftName()),
    type: kind,
    host: validateRequired('Host', draftHost()),
    user: validateRequired('Usuário', draftUser() || (isWindowsType(kind) ? 'Administrator' : 'root')),
    port: validatePort(draftPort(), defaultPort(kind)),
    transport: draftTransport() || defaultTransport(kind),
    identity_file: deployMasterKey ? MARKSCODE_MASTER_IDENTITY_FILE : draftAuth() === 'identity' ? validateRequired('Identity file', draftAuthValue()) : undefined,
    key_name: deployMasterKey ? MARKSCODE_MASTER_KEY_NAME : undefined,
    credential_ref: draftAuth() === 'credential' ? validateRequired('Credential ref', draftAuthValue()) : undefined,
    auth_method: deployMasterKey ? (draftAuth() === 'master_password' ? 'key_with_password_bootstrap' : 'key') : draftAuth() === 'identity' ? 'key' : draftAuth() === 'credential' ? (kind === 'whm' ? 'api_token_ref' : 'credential_ref') : draftAuth() === 'password' ? 'password_saved' : undefined,
    protocol: kind,
    master_key_ref: deployMasterKey ? MARKSCODE_MASTER_KEY_NAME : undefined,
    encrypted_password: draftAuth() === 'password' || draftAuth() === 'master_password' ? encodeCredential(validateRequired('Senha', draftAuthValue())) : undefined,
    pki_enabled: deployMasterKey ? 1 : 0,
  })
  }

  const reviewText = (profile: RemoteSSHProfile) => [
    'Revise antes de salvar',
    '',
    'Nome: ' + String(profile.name),
    'Tipo: ' + String(profile.type || 'ssh'),
    'Host: ' + String(profile.host),
    'Usuário: ' + String(profile.user),
    'Porta: ' + String(profile.port),
    'Transporte: ' + String(profile.transport || '-'),
    'Autenticação: ' + String(profile.auth_method || 'configurar depois'),
    'Chave mestra: ' + (profile.key_name === MARKSCODE_MASTER_KEY_NAME ? 'sim' : 'não'),
    'Identity file: ' + String(profile.identity_file || '-'),
    'Credential ref: ' + String(profile.credential_ref ? '***ref***' : '-'),
    'Senha salva: ' + (profile.encrypted_password ? 'sim (mascarada/codificada para bootstrap)' : 'não'),
    '',
    profile.encrypted_password ? 'Nenhum campo password/senha em texto puro será salvo; senha mascarada/codificada para bootstrap/acesso necessário.' : 'Nenhum campo password/senha em texto puro será salvo.',
  ].join('\n')

  const saveProfile = (profile: RemoteSSHProfile) => {
    rejectPlaintextSecretFields(profile as unknown as Record<string, unknown>)
    const warning = saveProfiles([...loadProfiles().filter((item) => item.id !== profile.id && item.name !== profile.name), profile])
    refreshProfiles()
    setKV('remote_ssh_mode', true)
    setKV('remote_ssh_config', { type: profile.type || 'ssh', host: profile.host, user: profile.user, port: profile.port, identity_file: profile.identity_file, key_name: profile.key_name, host_alias: profile.host_alias, credential_ref: profile.credential_ref, auth_method: profile.auth_method, protocol: profile.protocol || profile.type || 'ssh', transport: profile.transport, master_key_ref: profile.master_key_ref, encrypted_password: profile.encrypted_password, pki_enabled: profile.pki_enabled })
    setKV('remote_ssh_active_profile', profile.id)
    setKV('remote_ssh_profile_name', profile.name)
    if (profile.key_name === MARKSCODE_MASTER_KEY_NAME) {
      setKV('remote_ssh_deploy_key', '1')
      setKV('remote_ssh_deploy_host', profile.host)
      setKV('remote_ssh_deploy_user', profile.user)
    }
    showAlert('Perfil salvo', warning ? 'Perfil salvo em fallback de sessão e ativado. O DB não recebeu a gravação agora; o perfil aparecerá em Use/sidebar nesta sessão. ' + warning : profile.encrypted_password ? 'Perfil salvo e ativado. Nenhum campo password/senha em texto puro foi salvo; senha mascarada/codificada para bootstrap/acesso necessário.' : 'Perfil salvo e ativado com sucesso sem campos password/senha em texto puro.', () => setStep('menu'))
  }

  const setActiveProfile = (profileId: string) => {
    const p = findProfile(profileId)
    if (!p) return
    setKV('remote_ssh_mode', true)
    setKV('remote_ssh_config', {
      type: p.type || 'ssh',
      host: p.host,
      user: p.user,
      port: p.port,
      identity_file: p.identity_file,
      key_name: p.key_name,
      host_alias: p.host_alias,
      credential_ref: p.credential_ref,
      auth_method: p.auth_method,
      protocol: p.protocol || p.type || 'ssh',
      transport: p.transport,
      master_key_ref: p.master_key_ref,
      encrypted_password: p.encrypted_password,
      pki_enabled: p.pki_enabled,
    })
    setKV('remote_ssh_active_profile', p.id)
    setKV('remote_ssh_profile_name', p.name)
    showAlert('Perfil ativo', 'Perfil ' + String(p.name) + ' ativado para esta sessão.', () => setStep('menu'))
  }

  const assignMasterKey = (profileId: string) => {
    const p = findProfile(profileId)
    if (!p) return
    if (normalizeType(p.type) !== 'ssh') { showAlert('Perfil incompatível', 'Selecione um perfil SSH/Linux.', () => setStep('menu')); return }
    void ensureMarksMasterKey().then(() => {
      const profile = normalizeProfile({ ...p, identity_file: MARKSCODE_MASTER_IDENTITY_FILE, key_name: MARKSCODE_MASTER_KEY_NAME, master_key_ref: MARKSCODE_MASTER_KEY_NAME, pki_enabled: 1, auth_method: p.encrypted_password ? 'key_with_password_bootstrap' : 'key' })
      const warning = saveProfiles([...loadProfiles().filter((item) => item.id !== profile.id && item.name !== profile.name), profile])
      refreshProfiles()
      setActiveProfile(profile.id)
      setKV('remote_ssh_deploy_key', '1')
      setKV('remote_ssh_deploy_host', profile.host)
      setKV('remote_ssh_deploy_user', profile.user)
      showAlert('Chave mestra atribuída', (warning ? warning + '\n\n' : '') + 'Perfil SSH atualizado e ativado para deploy. Senha salva disponível internamente: ' + (profile.encrypted_password ? 'sim (segredo não exibido).' : 'não.'), () => setStep('menu'))
    }).catch((error) => showAlert('Erro', error instanceof Error ? error.message : String(error), () => setStep('menu')))
  }

  const showDeployCommand = (profileId: string) => {
    const p = findProfile(profileId)
    if (!p) return
    if (normalizeType(p.type) !== 'ssh') { showAlert('Perfil incompatível', 'Selecione um perfil SSH/Linux.', () => setStep('menu')); return }
    void ensureMarksMasterKey().then(() => showAlert('Comando de deploy da chave mestra', masterKeyDeployCommandText(p), () => setStep('menu'))).catch((error) => showAlert('Erro', error instanceof Error ? error.message : String(error), () => setStep('menu')))
  }

  const importProfileJSON = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr) as Partial<RemoteSSHProfile> & Record<string, unknown>
      rejectPlaintextSecretFields(data)
      if (!data.name || !data.host || !data.user) throw new Error('JSON inválido: name, host e user são obrigatórios.')
      const profile = normalizeProfile({ ...data, name: String(data.name), host: String(data.host), user: String(data.user) })
      saveProfiles([...loadProfiles().filter((item) => item.id !== profile.id && item.name !== profile.name), profile])
      refreshProfiles()
      showAlert('Perfil importado', 'Perfil ' + String(profile.name) + ' importado com sucesso.', () => setStep('menu'))
    } catch (e) {
      showAlert('Erro', 'Falha ao importar: ' + (e instanceof Error ? e.message : String(e)), () => setStep('menu'))
    }
  }

  const updateProfile = (profileId: string, changes: Partial<RemoteSSHProfile>) => {
    saveProfiles(loadProfiles().map((profile) => profile.id === profileId ? normalizeProfile({ ...profile, ...changes, name: changes.name || profile.name, host: changes.host || profile.host, user: changes.user || profile.user }) : profile))
    refreshProfiles()
  }

  const renderStep = () => {
    const s = step()
    if (s === 'menu') {
      return <DialogSelect title='Gerenciar Perfis Remotos' options={[
        { title: 'Create SSH/Linux profile', value: 'create-ssh-name', description: 'Wizard guiado para Linux/SSH' },
        { title: 'Create WinRM/Windows profile', value: 'create-winrm-name', description: 'Wizard guiado para Windows via WinRM' },
        { title: 'Create PowerShell/Windows profile', value: 'create-powershell-name', description: 'Wizard guiado para PowerShell remoto direto' },
        { title: 'Create WHM/cPanel profile', value: 'create-whm-name', description: 'Wizard guiado para WHM/cPanel' },
        { title: 'Criar/validar chave mestra Marks', value: 'master-key', description: 'Garante ~/.ssh/marks-key-mestra sem sobrescrever chave existente' },
        { title: 'Atribuir deploy da chave mestra a perfil SSH', value: 'select-for-assign-master', description: 'Marca perfil SSH para usar marks-key-mestra sem expor senha' },
        { title: 'Gerar comando de deploy da chave mestra', value: 'select-for-deploy-command', description: 'Exibe comandos copyable sem senha; não executa' },
        { title: 'Use profile', value: 'select-for-use', description: 'Ativar perfil salvo' },
        { title: 'Edit profile', value: 'select-for-edit', description: 'Editar perfil existente' },
        { title: 'Delete profile', value: 'select-for-delete', description: 'Remover perfil' },
        { title: 'Export/copy JSON', value: 'select-for-export', description: 'Mostrar JSON seguro para copiar' },
        { title: 'Import JSON (advanced)', value: 'import-json-input', description: 'Importar JSON sem password/senha' },
        { title: 'Close', value: 'close', description: 'Fechar' },
      ]} onSelect={(opt: DialogSelectOption<string>) => {
        if (opt.value === 'close') { dialog.clear(); return }
        if (opt.value === 'master-key') { void ensureMarksMasterKey().then((message) => showAlert('Chave mestra Marks', message, () => setStep('menu'))).catch((error) => showAlert('Erro', error instanceof Error ? error.message : String(error), () => setStep('menu'))); return }
        setStep(opt.value as DialogStep)
      }} />
    }
    if (s.endsWith('-name') && s.startsWith('create-')) {
      const kind = s.includes('winrm') ? 'winrm' : s.includes('powershell') ? 'powershell' : s.includes('whm') ? 'whm' : 'ssh'
      return <DialogPrompt title={labelFor(kind) + ' profile - name'} placeholder='ex: production-server' value='' onConfirm={(v: string) => { setDraftKind(kind); setDraftName(v); setDraftPort(String(defaultPort(kind))); setDraftTransport(defaultTransport(kind) || ''); setStep(('create-' + kind + '-host') as DialogStep) }} onCancel={() => setStep('menu')} />
    }
    if (s.endsWith('-host') && s.startsWith('create-')) return <DialogPrompt title={labelFor(draftKind()) + ' profile - host'} placeholder={isWindowsType(draftKind()) ? 'windows.example.com' : 'server.example.com'} value='' onConfirm={(v: string) => { setDraftHost(v); setStep(('create-' + draftKind() + '-user') as DialogStep) }} onCancel={() => setStep('menu')} />
    if (s.endsWith('-user') && s.startsWith('create-')) return <DialogPrompt title={labelFor(draftKind()) + ' profile - user'} placeholder={isWindowsType(draftKind()) ? 'Administrator' : 'root'} value={isWindowsType(draftKind()) ? 'Administrator' : 'root'} onConfirm={(v: string) => { setDraftUser(v || (isWindowsType(draftKind()) ? 'Administrator' : 'root')); setStep(('create-' + draftKind() + '-port') as DialogStep) }} onCancel={() => setStep('menu')} />
    if (s.endsWith('-port') && s.startsWith('create-')) return <DialogPrompt title={labelFor(draftKind()) + ' profile - port'} placeholder={String(defaultPort(draftKind()))} value={String(defaultPort(draftKind()))} onConfirm={(v: string) => { setDraftPort(v); setStep((isWindowsType(draftKind()) ? 'create-' + draftKind() + '-transport' : 'create-' + draftKind() + '-auth') as DialogStep) }} onCancel={() => setStep('menu')} />
    if (s === 'create-winrm-transport' || s === 'create-powershell-transport') return <DialogSelect title={labelFor(draftKind()) + ' transport'} options={[
      { title: 'HTTPS (5986)', value: 'https', description: 'Padrão recomendado para Windows remoto' },
      { title: 'HTTP (5985)', value: 'http', description: 'Somente se configurado no host Windows' },
    ]} onSelect={(opt: DialogSelectOption<'http' | 'https'>) => { setDraftTransport(opt.value); setStep(('create-' + draftKind() + '-auth') as DialogStep) }} />
    if (s === 'create-ssh-auth') return <DialogSelect title='Método de autenticação SSH' options={[
      { title: 'Deploy/use MarksCode master key', value: 'master', description: 'Usa marks-key-mestra' },
      { title: 'Password saved for SSH bootstrap/deploy', value: 'password', description: 'Senha mascarada/codificada para primeiro acesso' },
      { title: 'Deploy master key using saved password', value: 'master_password', description: 'Senha para bootstrap e deploy da chave mestra' },
      { title: 'Identity file', value: 'identity', description: 'Caminho da chave privada' },
      { title: 'Credential ref', value: 'credential', description: 'Referência segura existente' },
      { title: 'Skip for now', value: 'skip', description: 'Configurar depois' },
    ]} onSelect={(opt: DialogSelectOption<AuthChoice>) => { setDraftAuth(opt.value); setDraftAuthValue(''); setStep(opt.value === 'identity' || opt.value === 'credential' || opt.value === 'password' || opt.value === 'master_password' ? 'create-ssh-auth-value' : 'create-ssh-review') }} />
    if (s === 'create-winrm-auth' || s === 'create-powershell-auth') return <DialogSelect title={'Método de autenticação ' + labelFor(draftKind())} options={[
      { title: 'Password saved for Windows remote access', value: 'password', description: 'Senha mascarada/codificada; não será exibida' },
      { title: 'Credential ref', value: 'credential', description: 'Referência segura existente' },
      { title: 'Skip for now', value: 'skip', description: 'Configurar depois' },
    ]} onSelect={(opt: DialogSelectOption<AuthChoice>) => { setDraftAuth(opt.value); setDraftAuthValue(''); setStep(opt.value === 'credential' || opt.value === 'password' ? ('create-' + draftKind() + '-auth-value') as DialogStep : ('create-' + draftKind() + '-review') as DialogStep) }} />
    if (s === 'create-whm-auth') return <DialogSelect title='Método de autenticação WHM' options={[
      { title: 'API token credential ref', value: 'credential', description: 'Preferido; não cole token/senha aqui' },
      { title: 'Skip for now', value: 'skip', description: 'Configurar depois' },
    ]} onSelect={(opt: DialogSelectOption<AuthChoice>) => { setDraftAuth(opt.value); setDraftAuthValue(''); setStep(opt.value === 'credential' ? 'create-whm-auth-value' : 'create-whm-review') }} />
    if (s.endsWith('-auth-value') && s.startsWith('create-')) return <DialogPrompt title={draftAuth() === 'identity' ? 'Identity file' : draftAuth() === 'password' || draftAuth() === 'master_password' ? labelFor(draftKind()) + ' password (masked after save)' : 'Credential ref'} placeholder={draftAuth() === 'identity' ? '~/.ssh/id_ed25519' : draftAuth() === 'password' || draftAuth() === 'master_password' ? 'senha para bootstrap/acesso remoto' : 'cred://remote/prod-root'} value='' onConfirm={(v: string) => { setDraftAuthValue(v); setStep(('create-' + draftKind() + '-review') as DialogStep) }} onCancel={() => setStep('menu')} />
    if (s.endsWith('-review') && s.startsWith('create-')) {
      try {
        const profile = buildDraftProfile(draftKind())
        return <DialogSelect title='Review before save' options={[
          { title: 'Salvar perfil agora', value: 'save', description: 'Pressione Enter aqui para salvar', details: [reviewText(profile)] },
          { title: 'Back to menu', value: 'cancel', description: 'Cancelar sem salvar' },
        ]} onSelect={(opt: DialogSelectOption<string>) => { if (opt.value === 'save') saveProfile(profile); else setStep('menu') }} />
      } catch (e) {
        showAlert('Validação', e instanceof Error ? e.message : String(e), () => setStep('menu'))
        return <text>{'Validando...'}</text>
      }
    }
    if (s === 'select-for-use') return <DialogSelect title='Use profile' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => setActiveProfile(opt.value)} />
    if (s === 'select-for-assign-master') return <DialogSelect title='Atribuir chave mestra a perfil SSH' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => assignMasterKey(opt.value)} />
    if (s === 'select-for-deploy-command') return <DialogSelect title='Gerar comando de deploy da chave mestra' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => showDeployCommand(opt.value)} />
    if (s === 'select-for-delete') return <DialogSelect title='Delete profile' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => { setEditProfileId(opt.value); setStep('delete-confirm') }} />
    if (s === 'delete-confirm') {
      const p = findProfile(editProfileId())
      return <DialogConfirm title='Excluir perfil?' message={'Remover perfil ' + String(p?.name || '') + '?'} label='Cancelar' onConfirm={() => { saveProfiles(loadProfiles().filter((profile) => profile.id !== editProfileId())); refreshProfiles(); showAlert('Perfil excluído', 'Perfil removido com sucesso.', () => setStep('menu')) }} onCancel={() => setStep('menu')} />
    }
    if (s === 'select-for-export') return <DialogSelect title='Export/copy JSON' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => { const p = findProfile(opt.value); showAlert('Perfil: ' + String(p?.name || ''), p ? safeJSON(p) : 'Perfil não encontrado.', () => setStep('menu')) }} />
    if (s === 'select-for-edit') return <DialogSelect title='Edit profile' options={profileOptions()} onSelect={(opt: DialogSelectOption<string>) => { setEditProfileId(opt.value); setStep('edit-name') }} />
    if (s === 'edit-name') { const p = findProfile(editProfileId()); return <DialogPrompt title='Editar nome' placeholder='Nome:' value={String(p?.name || '')} onConfirm={(v: string) => { updateProfile(editProfileId(), { name: validateRequired('Nome', v) }); setStep('edit-host') }} onCancel={() => setStep('menu')} /> }
    if (s === 'edit-host') { const p = findProfile(editProfileId()); return <DialogPrompt title='Editar host' placeholder='Host:' value={String(p?.host || '')} onConfirm={(v: string) => { updateProfile(editProfileId(), { host: validateRequired('Host', v) }); setStep('edit-user') }} onCancel={() => setStep('menu')} /> }
    if (s === 'edit-user') { const p = findProfile(editProfileId()); return <DialogPrompt title='Editar usuário' placeholder='Usuário:' value={String(p?.user || 'root')} onConfirm={(v: string) => { updateProfile(editProfileId(), { user: validateRequired('Usuário', v) }); setStep('edit-port') }} onCancel={() => setStep('menu')} /> }
    if (s === 'edit-port') { const p = findProfile(editProfileId()); return <DialogPrompt title='Editar porta' placeholder='Porta:' value={String(p?.port || 22)} onConfirm={(v: string) => { updateProfile(editProfileId(), { port: validatePort(v, p?.type === 'whm' ? 2087 : 22) }); showAlert('Perfil editado', 'Perfil atualizado com sucesso.', () => setStep('menu')) }} onCancel={() => setStep('menu')} /> }
    if (s === 'import-json-input') return <DialogPrompt title='Import JSON (advanced)' placeholder='Cole JSON sem password/senha:' value='' onConfirm={(v: string) => { setImportJSON(v); setStep('import-json-confirm') }} onCancel={() => setStep('menu')} />
    if (s === 'import-json-confirm') return <DialogConfirm title='Importar perfil?' message='Importar este perfil do JSON seguro?' label='Cancelar' onConfirm={() => importProfileJSON(importJSON())} onCancel={() => setStep('menu')} />
    return <text>{'Unknown step: ' + String(s)}</text>
  }

  return (
    <box gap={1}>
      <text fg={theme().text}>{'Gerenciar Perfis Remotos'}</text>
      {renderStep()}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  registerPluginAPI(api)
  api.slots.register({
    order: 225,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
