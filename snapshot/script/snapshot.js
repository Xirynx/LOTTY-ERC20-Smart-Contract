const ethers = require('ethers');
const XlsxPopulate = require('xlsx-populate');

const LOTTY_ADDRESS = '0xB459F7204A8Ac84F9e7758d6d839eBD01670E35C';
const PAIR_ADDRESS = '0x1840c51b131a51bb66f3019cc7b2d54e6d686e10';
const START_BLOCK = 17370667;
const abi = ['event Transfer(address indexed from, address indexed to, uint value)']

const getPastLogs = async (contract, filter, fromBlock, toBlock) => {
	if (fromBlock > toBlock) return [];
	try {
		events = await contract.queryFilter(filter, fromBlock, toBlock);
	}
	catch (err) {
		console.log(err);
		const midBlock = (fromBlock + toBlock) >> 1;
		const firstHalf = await getPastLogs(contract, filter, fromBlock, midBlock);
		const secondHalf = await getPastLogs(contract, filter, midBlock + 1, toBlock);
		return [...firstHalf, ...secondHalf];
	}
	return events;
}

const convertTransferLogsToBalancesMap = async (logs) => {
	const balances = new Map();
	const balanceAdd = (address, value) => {
		const balance = balances.get(address) ?? 0n;
		balances.set(address, balance + value);
	}
	const balanceSub = (address, value) => {
		const balance = balances.get(address) ?? 0n;
		balances.set(address, balance - value);
	}
	logs.forEach(log => {
		const { from, to, value } = log.args;
		if (from !== ethers.ZeroAddress) {
			balanceSub(from, value);
		}
		if (to !== ethers.ZeroAddress) {
			balanceAdd(to, value);
		}
	})

	for (const [address, balance] of balances.entries()) {
		if (balance === 0n) {
			balances.delete(address);
		}
	}

	return balances;
}

const main = async () => {
	const provider = new ethers.JsonRpcProvider('http://hypernode.justcubes.io:8545');

	const tokenContract = new ethers.Contract(LOTTY_ADDRESS, abi, provider);
	const lpContract = new ethers.Contract(PAIR_ADDRESS, abi, provider);

	const currentBlock = await provider.getBlockNumber();
	console.log(`Current block: ${currentBlock}`);
	const transferFilter = tokenContract.filters.Transfer;

	const logs = await Promise.all([
		getPastLogs(tokenContract, transferFilter, START_BLOCK, currentBlock),
		getPastLogs(lpContract, transferFilter, START_BLOCK, currentBlock),
	]);

	const tokenBalances = await convertTransferLogsToBalancesMap(logs[0]);
	const lpBalances = await convertTransferLogsToBalancesMap(logs[1]);

	const tokenSheetName = 'Token Balances';
	const lpSheetName = 'LP Balances';

	// Create a new workbook
	XlsxPopulate.fromBlankAsync()
		.then(workbook => {
			// Create the tokenBalances sheet
			const tokenSheet = workbook.addSheet(tokenSheetName);
			tokenSheet.cell('A1').value('Address');
			tokenSheet.cell('B1').value('Balance');
			tokenSheet.cell('C1').value('% Owned');
			tokenSheet.row(1).style({ bold: true });

			// Populate the tokenBalances sheet
			let tokenRowIndex = 2;
			tokenBalances.forEach((balance, address) => {
				const percentOwnedFormula = `=B${tokenRowIndex}/SUM(B:B)`;
				tokenSheet.cell(`A${tokenRowIndex}`).value(address);
				tokenSheet.cell(`B${tokenRowIndex}`).value(Number(ethers.formatEther(balance)));
				tokenSheet.cell(`C${tokenRowIndex}`).formula(percentOwnedFormula);
				tokenRowIndex++;
			});

			tokenSheet.column('C').style({ numberFormat: '0.00%' });

			// Create the lpBalances sheet
			const lpSheet = workbook.addSheet(lpSheetName);
			lpSheet.cell('A1').value('Address');
			lpSheet.cell('B1').value('Balance');
			lpSheet.cell('C1').value('% Owned');
			lpSheet.row(1).style({ bold: true });

			// Populate the lpBalances sheet
			let lpRowIndex = 2;
			lpBalances.forEach((balance, address) => {
				const percentOwnedFormula = `=B${lpRowIndex}/SUM(B:B)`;
				lpSheet.cell(`A${lpRowIndex}`).value(address);
				lpSheet.cell(`B${lpRowIndex}`).value(Number(ethers.formatEther(balance)));
				lpSheet.cell(`C${lpRowIndex}`).formula(percentOwnedFormula);
				lpRowIndex++;
			});

			lpSheet.column('C').style({ numberFormat: '0.00%' });

			// Delete the default Sheet1
			workbook.deleteSheet('Sheet1');

			// Save the workbook to a file
			return workbook.toFileAsync('./balances.xlsx');
		})
		.then(() => {
			console.log('Excel file created successfully!');
		})
		.catch((error) => {
			console.error('Error creating Excel file:', error);
		});
}

main()



