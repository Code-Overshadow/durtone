import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

export type AwsCredential = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

/** Cheapest possible "are these credentials valid" check - sts:GetCallerIdentity requires no IAM
 * permissions beyond being an authenticated principal, unlike the broad read access Prowler needs
 * for the real scan. */
export async function testAwsConnection(credential: AwsCredential, region: string): Promise<void> {
  const client = new STSClient({
    region: region || 'us-east-1',
    credentials: credential.accessKeyId && credential.secretAccessKey ? {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
      ...(credential.sessionToken ? { sessionToken: credential.sessionToken } : {}),
    } : undefined,
  });
  await client.send(new GetCallerIdentityCommand({}));
}
