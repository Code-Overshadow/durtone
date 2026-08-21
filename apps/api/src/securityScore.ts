export type SecurityScoreInput = {
  waf: {
    totalRequests: number;
    blockedRequests: number;
  };
  cspm: {
    postureScore: number;
  };
  itdr: {
    totalIdentities: number;
    highRiskIdentities: number;
    staleIdentities: number;
  };
};

export type SecurityScore = {
  score: number;
  components: {
    waf: number;
    cspm: number;
    itdr: number;
  };
  weights: {
    waf: number;
    cspm: number;
    itdr: number;
  };
};

function bounded(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateSecurityScore(input: SecurityScoreInput): SecurityScore {
  const waf = input.waf.totalRequests === 0
    ? 100
    : bounded((input.waf.blockedRequests / input.waf.totalRequests) * 100);
  const cspm = bounded(input.cspm.postureScore);
  const identityRiskRate = input.itdr.totalIdentities === 0
    ? 0
    : (input.itdr.highRiskIdentities + input.itdr.staleIdentities) / input.itdr.totalIdentities;
  const itdr = bounded(100 - identityRiskRate * 100);
  const weights = { waf: 0.4, cspm: 0.3, itdr: 0.3 };

  return {
    score: bounded(waf * weights.waf + cspm * weights.cspm + itdr * weights.itdr),
    components: { waf, cspm, itdr },
    weights,
  };
}
