import { DateTime } from 'luxon';
import fetch from 'node-fetch';
import * as puppeteer from 'puppeteer'
import * as urlParser from 'url'

import * as dotenv from 'dotenv'
dotenv.config()

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

export class API {
  constructor() {
    this.token = ''
    this.url = "https://ime-pro.hasura.app/v1/graphql"
  }

  getToken = async () => {
    console.log('fetching token...')
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto('https://auth.imperiumempires.com/?next=https://apollo.imperiumempires.com');

    await page.waitForSelector('input[type="email"]');
    await page.focus('input[type="email"]');

    await page.type('input[type="email"]', process.env.USER, { delay: 100 });
    
    await page.focus('input[type="password"]')
    await page.type('input[type="password"]', process.env.PASSWORD, { delay: 100 });

    await page.keyboard.press('Enter');

    await page.waitForNavigation({waitUntil: 'networkidle2'})

    await page.waitForSelector('#app');

    this.token = urlParser.parse(page.url(), true).query.token;
    await browser.close();
  }

  headers() {
    return {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,da;q=0.8",
      "authorization": "Bearer " + this.token,
      "content-type": "application/json",
      "sec-ch-ua": "\"Google Chrome\";v=\"105\", \"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"105\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "cross-site",
      "Referer": "https://apollo.imperiumempires.com/",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  }

  query = async (request, url) => {
    await delay(1000)

    const response = await fetch(url || this.url, {
      "headers": this.headers(),
      ...request
    })

    const data = await response.json()
    
    if (data.errors && data.errors.length > 0 && data.errors[0].message === "Could not verify JWT: JWTExpired") {
      await getToken()
      return this.query(request, url)
    }

    return data
  }

  getZones = async () => {
    const data = await this.query({
      "body": "{\"operationName\":\"ZONES\",\"variables\":{},\"query\":\"query ZONES {\\n  zones {\\n    id\\n    name\\n    radius\\n    zone_type\\n    fleets_count: count_fleets\\n    events_count: count_current_zone_events\\n    structures: zone_structures_aggregate {\\n      total: aggregate {\\n        count\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data.data.zones.map(x => x.id)
  }

  getEvents = async (zone) => {
    const data = await this.query({
      "body": "{\"operationName\":\"ZoneEvents\",\"variables\":{\"zone_id\":\"" + zone + "\"},\"query\":\"query ZoneEvents($zone_id: Int!) {\\n  events: zone_events(\\n    where: {zone_id: {_eq: $zone_id}, reward_left: {_gt: 0}, end_time: {_gt: \\\"now()\\\"}}\\n    order_by: {spec: {event_type: asc}, end_time: desc}\\n  ) {\\n    id\\n    zone_id\\n    zone_event_type_id\\n    q\\n    r\\n    start_time\\n    end_time\\n    reward_left\\n    reward_total\\n    reward_type\\n    count_joined_fleets\\n    count_lurking_fleets\\n    spec {\\n      type: event_type\\n      weight\\n      reward_qty\\n      reward_type\\n      event_time_cost\\n      event_hours\\n      event_budget_cost\\n      __typename\\n    }\\n    updated_at\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data.data.events;
  }

  getStructureEvents = async (zone) => {
    const data = await this.query({
      "body": "{\"operationName\":\"ZoneStructures\",\"variables\":{\"zone_id\":\"" + zone + "\"},\"query\":\"query ZoneStructures($zone_id: Int!) {\\n  structures: zone_structures(\\n    where: {_and: {zone_id: {_eq: $zone_id}, _or: [{end_time: {_is_null: true}}, {end_time: {_gt: \\\"now()\\\"}}]}}\\n    order_by: {spec: {structure_type: asc}, end_time: desc_nulls_first}\\n  ) {\\n    id\\n    zone_id\\n    zone_structure_type_id\\n    q\\n    r\\n    start_time\\n    end_time\\n    count_joined_fleets\\n    count_lurking_fleets\\n    spec {\\n      type: structure_type\\n      event_time_cost\\n      inputs {\\n        input_ratio\\n        input_type\\n        __typename\\n      }\\n      output_ratio_normal\\n      output_ratio_super\\n      output_type\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data.data.structures
  }

  getFleets = async () => {
    const data = await this.query({
      "body": "{\"operationName\":\"FLEETS\",\"variables\":{\"player\":\"8dc1b21b-15ea-4ecf-a09f-b2b563c5e1e8\"},\"query\":\"query FLEETS($player: uuid!) {\\n  fleets(where: {controller_id: {_eq: $player}}, order_by: {created_at: asc}) {\\n    id\\n    name\\n    state\\n    location\\n    zone_id\\n    zone_pos\\n    zone_target_pos\\n    zone_movement_start_time\\n    zone_movement_end_time\\n    ships(order_by: {unit_slot: asc}) {\\n      id\\n      fleet_id\\n      ship_model_id\\n      capacity_rank\\n      hp_rank\\n      ipfs_url\\n      speed_rank\\n      turn_rate_rank\\n      ship_skill_id\\n      unit_slot\\n      skin\\n      model {\\n        id\\n        model\\n        name\\n        rarity\\n        size\\n        support_slots\\n        unlock_condition\\n        shield_slots\\n        gun_slots\\n        armor_type\\n        any_slots\\n        mining_slots\\n        length\\n        character_slots\\n        class\\n        description\\n        power\\n        usd_price\\n        shortname\\n        total_supply\\n        speed_level\\n        turn_rate_level\\n        capacity_level\\n        base_hp_level\\n        images\\n        contract\\n        max_qty\\n        max_fuel\\n        __typename\\n      }\\n      stats {\\n        geared_capacity\\n        __typename\\n      }\\n      cargo {\\n        amount\\n        resource_type\\n        __typename\\n      }\\n      is_damaged\\n      fuel\\n      hp\\n      healing_end_time\\n      __typename\\n    }\\n    current_zone_event {\\n      id\\n      fleet_id\\n      is_finished\\n      start_time\\n      end_time\\n      structure: zone_structure {\\n        spec {\\n          type: structure_type\\n          __typename\\n        }\\n        __typename\\n      }\\n      event: zone_event {\\n        spec {\\n          type: event_type\\n          __typename\\n        }\\n        __typename\\n      }\\n      __typename\\n    }\\n    current_zone_lurk {\\n      id\\n      start_time\\n      end_time\\n      q\\n      r\\n      __typename\\n    }\\n    updated_at\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data.data.fleets;
  }

  moveFleets = async (fleets, position) => {
    const fleetIds = fleets.map(x => x.id)

    const data = await this.query({
      "body": "{\"operationName\":\"MoveFleets\",\"variables\":{\"fleetIds\":" + JSON.stringify(fleetIds) + ",\"targetPos\":\"(" + position[0] + "," + position[1] + ")\"},\"query\":\"mutation MoveFleets($fleetIds: [uuid!], $targetPos: point!) {\\n  move: update_fleets(\\n    where: {id: {_in: $fleetIds}}\\n    _set: {zone_target_pos: $targetPos}\\n  ) {\\n    fleets: returning {\\n      id\\n      name\\n      ships {\\n        id\\n        unit_slot\\n        model {\\n          power\\n          name\\n          __typename\\n        }\\n        fuel\\n        hp\\n        healing_end_time\\n        stats {\\n          geared_capacity\\n          __typename\\n        }\\n        cargo {\\n          resource_type\\n          amount\\n          __typename\\n        }\\n        __typename\\n      }\\n      zone_movement_start_time\\n      zone_movement_end_time\\n      zone_pos\\n      zone_target_pos\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }


  launchFleets = async (fleets, structureId) => {
    const endTime = DateTime.utc().toISO()

    const fleetInputs = fleets.map(fleet => {
      return {
        fleet_id: fleet.id,
        zone_structure_id: structureId,
        end_time: endTime
      }
    })

    const data = await this.query({
      "body": "{\"operationName\":\"LaunchFleets\",\"variables\":{\"inputs\":" + JSON.stringify(fleetInputs) + "},\"query\":\"mutation LaunchFleets($inputs: [fleet_zone_events_insert_input!]!) {\\n  fleets: insert_fleet_zone_events(objects: $inputs) {\\n    returning {\\n      start_time\\n      end_time\\n      fleet {\\n        id\\n        name\\n        ships {\\n          id\\n          unit_slot\\n          model {\\n            power\\n            name\\n            __typename\\n          }\\n          fuel\\n          hp\\n          healing_end_time\\n          stats {\\n            geared_capacity\\n            __typename\\n          }\\n          cargo {\\n            resource_type\\n            amount\\n            __typename\\n          }\\n          __typename\\n        }\\n        __typename\\n      }\\n      ship_changes {\\n        resource_type\\n        old_amount\\n        new_amount\\n        amount\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }

  dockFleet = async (fleet, structureId) => {
    const input = [{
      fleet_id: fleet.id,
      zone_structure_id: structureId
    }]

    const data = await this.query({
      "body": "{\"operationName\":\"AssignEventToFleets\",\"variables\":{\"inputs\":" + JSON.stringify(input) + ",\"target\":\"" + fleet.zone_pos + "\"},\"query\":\"mutation AssignEventToFleets($inputs: [fleet_zone_events_insert_input!]!, $target: point!) {\\n  fleets: insert_fleet_zone_events(objects: $inputs) {\\n    returning {\\n      start_time\\n      end_time\\n      fleet {\\n        id\\n        name\\n        risk_at_zone_pos(args: {target: $target})\\n        ships {\\n          id\\n          unit_slot\\n          fuel\\n          hp\\n          healing_end_time\\n          cargo {\\n            resource_type\\n            amount\\n            __typename\\n          }\\n          model {\\n            power\\n            name\\n            __typename\\n          }\\n          __typename\\n        }\\n        __typename\\n      }\\n      ship_changes {\\n        resource_type\\n        amount\\n        old_amount\\n        new_amount\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }

  unloadFleet = async (fleet) => {
    if (!fleet.ships.find(ship => ship.cargo.length > 0)) {
      return
    }

    const events = []
    fleet.ships.forEach(ship => {

      ship.cargo.forEach(cargo => {
        events.push({
          ship_id: ship.id,
          resource_type: cargo.resource_type,
          amount: cargo.amount,
          reason: "Updated by user"
        })
      })

    })

    const data = await this.query({
      "body": "{\"operationName\":\"UNLOAD_SHIP_CARGO\",\"variables\":{\"unload_changes\":" + JSON.stringify(events) + ",\"load_changes\":[]},\"query\":\"mutation UNLOAD_SHIP_CARGO($unload_changes: [user_cargo_changes_insert_input!]!, $load_changes: [user_cargo_changes_insert_input!]!) {\\n  unload: insert_user_cargo_changes(objects: $unload_changes) {\\n    returning {\\n      user_id\\n      ship_id\\n      resource_type\\n      amount\\n      change_time\\n      __typename\\n    }\\n    __typename\\n  }\\n  load: insert_user_cargo_changes(objects: $load_changes) {\\n    returning {\\n      user_id\\n      ship_id\\n      resource_type\\n      amount\\n      change_time\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }

  fight = async (fleet, eventId) => {
    const input = [{
      fleet_id: fleet.id,
      zone_event_id: eventId
    }]

    const data = await this.query({
      "body": "{\"operationName\":\"AssignEventToFleets\",\"variables\":{\"inputs\":" + JSON.stringify(input) + ",\"target\":\"" + fleet.zone_pos + "\"},\"query\":\"mutation AssignEventToFleets($inputs: [fleet_zone_events_insert_input!]!, $target: point!) {\\n  fleets: insert_fleet_zone_events(objects: $inputs) {\\n    returning {\\n      start_time\\n      end_time\\n      fleet {\\n        id\\n        name\\n        risk_at_zone_pos(args: {target: $target})\\n        ships {\\n          id\\n          unit_slot\\n          fuel\\n          hp\\n          healing_end_time\\n          cargo {\\n            resource_type\\n            amount\\n            __typename\\n          }\\n          model {\\n            power\\n            name\\n            __typename\\n          }\\n          __typename\\n        }\\n        __typename\\n      }\\n      ship_changes {\\n        resource_type\\n        amount\\n        old_amount\\n        new_amount\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }

  stuctureInteract = async (fleet, structureId) => {
    const input = [{
      fleet_id: fleet.id,
      zone_structure_id: structureId
    }]

    const data = await this.query({
      "body": "{\"operationName\":\"AssignEventToFleets\",\"variables\":{\"inputs\":" + JSON.stringify(input) + ",\"target\":\"" + fleet.zone_pos + "\"},\"query\":\"mutation AssignEventToFleets($inputs: [fleet_zone_events_insert_input!]!, $target: point!) {\\n  fleets: insert_fleet_zone_events(objects: $inputs) {\\n    returning {\\n      start_time\\n      end_time\\n      fleet {\\n        id\\n        name\\n        risk_at_zone_pos(args: {target: $target})\\n        ships {\\n          id\\n          unit_slot\\n          fuel\\n          hp\\n          healing_end_time\\n          cargo {\\n            resource_type\\n            amount\\n            __typename\\n          }\\n          model {\\n            power\\n            name\\n            __typename\\n          }\\n          __typename\\n        }\\n        __typename\\n      }\\n      ship_changes {\\n        resource_type\\n        amount\\n        old_amount\\n        new_amount\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }

  getStorage = async () => {
    const data = await this.query({
      "body": "{\"operationName\":\"USER_CARGO\",\"variables\":{\"owner\":\"8dc1b21b-15ea-4ecf-a09f-b2b563c5e1e8\"},\"query\":\"query USER_CARGO($owner: uuid) {\\n  cargo: user_cargo(where: {user_id: {_eq: $owner}}) {\\n    amount\\n    resource_type\\n    user_id\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data.data.cargo;
  }

  loadFleet = async (fleet, resource_type) => {
    if (fleet.ships.find(ship => ship.cargo.length > 0)) {
      await unloadFleet(fleet)
    }

    const events = []
    fleet.ships.forEach(ship => {

      events.push({
        ship_id: ship.id,
        resource_type: resource_type,
        amount: -5000,
        reason: "Updated by user"
      })
    })

    const data = await this.query({
      "body": "{\"operationName\":\"UNLOAD_SHIP_CARGO\",\"variables\":{\"unload_changes\":[],\"load_changes\":" + JSON.stringify(events) + "},\"query\":\"mutation UNLOAD_SHIP_CARGO($unload_changes: [user_cargo_changes_insert_input!]!, $load_changes: [user_cargo_changes_insert_input!]!) {\\n  unload: insert_user_cargo_changes(objects: $unload_changes) {\\n    returning {\\n      user_id\\n      ship_id\\n      resource_type\\n      amount\\n      change_time\\n      __typename\\n    }\\n    __typename\\n  }\\n  load: insert_user_cargo_changes(objects: $load_changes) {\\n    returning {\\n      user_id\\n      ship_id\\n      resource_type\\n      amount\\n      change_time\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}",
      "method": "POST"
    });

    return data
  }
}