targetScope = 'resourceGroup'

@description('Deploy only after separate approval of Azure costs and resource changes.')
param location string = 'westeurope'
param appName string = 'openflowkit-hosted'
param hostname string = 'app.getopenflowkit.com'
param githubClientId string

@secure()
param githubClientSecret string

@secure()
@description('Base64-encoded random 32-byte key. Keep stable across deployments; changing it invalidates stored sign-ins.')
param sessionEncryptionKey string

@description('First deploy the foundation, then build/push the image, then deploy again with this enabled.')
param deployApplication bool = false
param containerImage string = ''
param managedCertificateId string = ''

var suffix = uniqueString(resourceGroup().id, appName)
var tableRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
var pullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var secretRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-runtime'
  location: location
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'ofk${suffix}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource stateTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'Flowpilot'
  properties: {}
}

resource tableAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, tableRole)
  scope: storage
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: tableRole
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'ofk${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource registryAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, pullRole)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: pullRole
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'ofk-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    accessPolicies: []
  }
}

resource clientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'github-client-secret'
  properties: { value: githubClientSecret }
}

resource sessionKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'session-encryption-key'
  properties: { value: sessionEncryptionKey }
}

resource secretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, secretRole)
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: secretRole
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${appName}-environment'
  location: location
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApplication) {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 3045
        transport: 'auto'
        allowInsecure: false
        traffic: [{ latestRevision: true, weight: 100 }]
        customDomains: empty(managedCertificateId) ? [] : [
          { name: hostname, bindingType: 'SniEnabled', certificateId: managedCertificateId }
        ]
      }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        { name: 'github-client-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/${clientSecret.name}', identity: identity.id }
        { name: 'session-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/${sessionKey.name}', identity: identity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'openflowkit'
          image: containerImage
          resources: { cpu: 1, memory: '2Gi' }
          env: [
            { name: 'PUBLIC_ORIGIN', value: 'https://${hostname}' }
            { name: 'HOSTED_GITHUB_CLIENT_ID', value: githubClientId }
            { name: 'HOSTED_GITHUB_CLIENT_SECRET', secretRef: 'github-client-secret' }
            { name: 'HOSTED_SESSION_KEY', secretRef: 'session-key' }
            { name: 'HOSTED_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 3045 }
              periodSeconds: 10
              timeoutSeconds: 20
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 3045 }
              periodSeconds: 15
              timeoutSeconds: 20
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 3045 }
              periodSeconds: 30
              timeoutSeconds: 20
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }]
      }
    }
  }
  dependsOn: [tableAccess, stateTable, registryAccess, secretAccess]
}

output registryName string = registry.name
output registryServer string = registry.properties.loginServer
output storageAccount string = storage.name
output vaultName string = vault.name
output containerAppName string = appName
output environmentName string = environment.name
output publicOrigin string = 'https://${hostname}'
output containerAppFqdn string = deployApplication ? app!.properties.configuration.ingress.fqdn : ''
