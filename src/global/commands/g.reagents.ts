const F = f(__filename);

export default reagents;

/**
 *
 * @return {any}
 */
export async function reagents():Promise<string> {
  // const response = 'https://i.imgur.com/wETJsZr.png';
  // eslint-disable-next-line max-len
  const response1 = 'https://raw.githubusercontent.com/theimperious1/TripBot/reagents-update/.github/images/reagents.png';
  // const response = 'https://raw.githubusercontent.com/TripSit/TripBot/reagents-update/.github/images/reagents.png';
  log.info(F, `response: ${JSON.stringify(response1, null, 2)}`);
  return response1;
}
