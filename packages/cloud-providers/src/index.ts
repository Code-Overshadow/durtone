import { testAwsConnection, type AwsCredential } from './aws';
import { testAzureConnection, type AzureCredential } from './azure';
import { testGcpConnection } from './gcp';

export type { AwsCredential } from './aws';
export type { AzureCredential } from './azure';

export type CloudProviderKind = 'aws' | 'azure' | 'gcp';

/**
 * Cheapest real call per provider that proves a cloud_accounts credential actually authenticates -
 * not the full Prowler scan. `credential` is the decrypted `credential_ref` JSON blob, `accountId`
 * is the DurtOne `cloud_accounts.account_id` column (subscription/project id for azure/gcp).
 */
export async function testCloudAccountConnection(provider: CloudProviderKind, credential: unknown, accountId: string): Promise<void> {
  const secret = (credential ?? {}) as Record<string, string>;
  switch (provider) {
    case 'aws':
      return testAwsConnection(secret as AwsCredential, secret.region ?? 'us-east-1');
    case 'azure':
      return testAzureConnection(secret as AzureCredential, accountId);
    case 'gcp':
      return testGcpConnection(secret.serviceAccountJson ?? '', accountId);
  }
}
