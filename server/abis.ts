import { parseAbiItem } from 'viem'

export const tip20 = {
  transfer: parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 amount)',
  ),
  transferWithMemo: parseAbiItem(
    'event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)',
  ),
} as const

export const tip403 = {
  policyCreated: parseAbiItem(
    'event PolicyCreated(uint64 indexed policyId, address indexed updater, uint8 policyType)',
  ),
  policyAdminUpdated: parseAbiItem(
    'event PolicyAdminUpdated(uint64 indexed policyId, address indexed updater, address indexed admin)',
  ),
  whitelistUpdated: parseAbiItem(
    'event WhitelistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool allowed)',
  ),
  blacklistUpdated: parseAbiItem(
    'event BlacklistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool restricted)',
  ),
} as const

export const feeManager = {
  getPool: parseAbiItem(
    'function getPool(address userToken, address validatorToken) view returns (uint256 reserveUserToken, uint256 reserveValidatorToken)',
  ),
} as const
