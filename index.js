const csvCreator = require('csv-writer').createObjectCsvWriter;
const fetch = require('node-fetch');
const moment = require('moment');
const fs = require('fs');

const GH_TOKEN = 'b6668104f4ca72d2c6b1df76e740d77e5b78d231';
const DATE = moment().format('yyyy-MM-DD HH:mm:ss');

const PATH_FOR_CSV = 'metrics';

if (!fs.existsSync(PATH_FOR_CSV)) {
    fs.mkdirSync(PATH_FOR_CSV);
}

const csv = csvCreator({
//    path: `${PATH_FOR_CSV}\\metrics_${DATE}.csv`,
      path: `${PATH_FOR_CSV}\\metrics.csv`,
    header: [
        {id: 'number', title: 'Number'},
        {id: 'title', title: 'Title'},
        {id: 'label', title: 'Label'},
        {id: 'backlog', title: 'backlog [WIP min 3]'},
        {id: 'development', title: 'in development [WIP 4]'},
        {id: 'approved_for_test', title: 'approved for TEST'},
        {id: 'deployed_to_test', title: 'deployed to TEST'},
        {id: 'approved_for_prod', title: 'approved for PROD'},
    ],
    fieldDelimiter: ';',
    headerIdDelimiter: ';'
})

const TICKETS_ABOVE_INCLUDING = Object.freeze(106)

const steps = Object.freeze([
    'backlog [WIP min 3]',
    'in development [WIP 4]',
    'approved for TEST',
    'deployed to TEST',
    'approved for PROD'
])
async function createMetrics() {
    let count = 0
    let page = 1
    let issues
    let metrics = []
    let done = false

    do {
        issues = await fetchIssuesOfRepo(page++)
        for (let issue of issues) {
            let obj

            // only use issues that are not a pull request
            if (!issue.hasOwnProperty('pull_request')) {
                let labelToSet = ''
                if (issue.hasOwnProperty('labels') && issue.labels.length !== 0) {
                    for (let label of issue.labels) {
                        if (label.name === 'user story' || label.name === 'technical story' || label.name === 'bug') {
                            labelToSet = label.name
                            break
                        }
                    }
                }

                obj = {
                    "number": issue.number,
                    "title": issue.title,
                    "label": labelToSet,
                    "closed_at": issue.closed_at ? issue.closed_at.substr(0, issue.closed_at.indexOf('T')) : issue.closed_at,
                    "events": []
                }
let events = await fetchEventsForIssue(issue.number)
                for (let event of events) {
                    if (event.event === 'added_to_project' || event.event === 'moved_columns_in_project' || event.event === 'converted_note_to_issue') {
                        if (event.hasOwnProperty('project_card') && event.project_card.project_id === 4946323) {
                            let prevColumn = event.project_card.previous_column_name
                            let currentColumn = event.project_card.column_name
                            if (currentColumn !== 'pre-backlog' && currentColumn !== 'triage') {
                                let newEvent = {
                                    "column": currentColumn,
                                    "date": event.created_at.substr(0, event.created_at.indexOf('T'))
                                }

                                if (obj.events.every(value => value.column !== currentColumn)) {
                                    obj.events.push(newEvent)
                                } else {
                                    if (steps.includes(prevColumn)) {
                                        let columnsToReset = steps.slice(steps.indexOf(currentColumn) + 1, steps.indexOf(prevColumn) + 1)
                                        for (let columnName of columnsToReset) {
                                            let matchingEvent = obj.events.find(value => value.column === columnName)
                                            if (matchingEvent) {
                                                if (newEvent.column === columnName) {
                                                    obj.events.splice(obj.events.indexOf(matchingEvent), 1, newEvent)
                                                } else {
                                                    obj.events.splice(obj.events.indexOf(matchingEvent), 1)
                                                }
                                            }
                                        }
                                    }
                                }
                            } else {
                                obj.events = []
                            }
                        }
                    } else if (event.event === 'removed_from_project') {
                        obj.events = []
                    } else if (event.event === 'closed') {
                        if (obj.events.every(value => value.column !== steps[steps.length - 1]) && obj.events.length > 0) {
                            obj.events.push({
                                "column": steps[steps.length - 1],
                                "date": event.created_at.substr(0, event.created_at.indexOf('T'))
                            })
                        }
                    }
                }
            }

            if (obj && obj.events.length > 0) {
                count++
                metrics.push(obj)
            }

            if (issue.number === TICKETS_ABOVE_INCLUDING) {
                done = true
                break
            }
        }
    } while (Object.keys(issues).length === 30 && !done)

    console.log(`Number of issues: ${count}`)
    console.log('--------------------------')

    await generateCsvData(metrics)
}
async function generateCsvData(metrics) {
    let csvData = []
    for (let issue of metrics) {

        let csvEntry = {
            number: issue.number,
            title: issue.title,
            label: issue.label,
            backlog: "",
            development: "",
            approved_for_test: "",
            deployed_to_test: "",
            approved_for_prod: ""
        }

        for (let event of issue.events) {
            if (event.column.includes('backlog')) {
                csvEntry.backlog = event.date
            } else if (event.column.includes('development')) {
                csvEntry.development = event.date
            } else if (event.column === 'approved for TEST') {
                csvEntry.approved_for_test = event.date
            } else if (event.column === 'deployed to TEST') {
                csvEntry.deployed_to_test = event.date
            } else if (event.column === 'approved for PROD') {
                csvEntry.approved_for_prod = event.date
            }
        }

        if (!isEmpty(issue.closed_at) && isEmpty(csvEntry.approved_for_prod)) {
            csvEntry.approved_for_prod = issue.closed_at
        }
        csvData.push(csvEntry)
    }

    csvData = workaroundDates(csvData)

    try {
        await csv.writeRecords(csvData);
        console.log('The CSV file was written successfully')
    } catch (e) {
        console.error(e)
    }
}

function workaroundDates(csvData) {

    for (let csvEntry of csvData) {
        if (isEmpty(csvEntry.deployed_to_test) && !isEmpty(csvEntry.approved_for_prod)) {
            csvEntry.deployed_to_test = csvEntry.approved_for_prod
        }
        if (isEmpty(csvEntry.approved_for_test) && !isEmpty(csvEntry.deployed_to_test)) {
            csvEntry.approved_for_test = csvEntry.deployed_to_test
        }
        if (isEmpty(csvEntry.development) && !isEmpty(csvEntry.approved_for_test)) {
            csvEntry.development = csvEntry.approved_for_test
        }
        if (isEmpty(csvEntry.backlog) && !isEmpty(csvEntry.development)) {
            csvEntry.backlog = csvEntry.development
        }
    }
    return csvData
}

function isEmpty(str) {
    return (!str || 0 === str.length)
}

async function fetchIssuesOfRepo(page, owner = 'Gepardec', repo = 'mega') {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&page=${page}`, {
        headers: {
            'Authorization': `token ${GH_TOKEN}`,
        }
    })
    return await response.json()
}

async function fetchEventsForIssue(issueNr, owner = 'Gepardec', repo = 'mega') {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNr}/events`, {
        headers: {
            'Authorization': `token ${GH_TOKEN}`,
            'Accept': 'application/vnd.github.starfox-preview+json'
        }
    })
    return await response.json()
}

createMetrics();
