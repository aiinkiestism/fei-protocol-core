import { ProposalsConfigMap } from '@custom-types/types';

// import fip_xx_proposal from '@proposals/description/fip_xx';

import peg_stability_module from '@proposals/description/peg_stability_module';
import fip_54_proposal from '@proposals/description/fip_54';

const proposals: ProposalsConfigMap = {
  /*
    fip_xx : {
        deploy: true, // deploy flag for whether to run deploy action during e2e tests or use mainnet state
        skipDAO: false, // whether or not to simulate proposal in DAO
        totalValue: 0, // amount of ETH to send to DAO execution
        proposal: fip_xx_proposal // full proposal file, imported from '@proposals/description/fip_xx.ts'
    }
    */
  peg_stability_module: {
    deploy: true,
    skipDAO: false,
    totalValue: 0,
    proposal: peg_stability_module
  }
};

export default proposals;
