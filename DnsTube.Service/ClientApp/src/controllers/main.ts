import '../style.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'three-dots/dist/three-dots.css'

import { format, parseISO, parseJSON } from 'date-fns'
import linkifyHtml from "linkify-html";
import { deleteLogAsync, getLogAsync } from '../services/log';
import { getSettingsAsync, saveDomainsAsync } from '../services/settings';
import { getIp } from '../services/ip';
import { getDnsEntries } from '../services/dns';
import { Settings } from '../model/Settings';
import { SelectedDomain } from '../model/SelectedDomain';
import { json } from 'stream/consumers';

let _settings: Settings | null = null;

init();

function init() {
	(document.getElementById("currentYear") as HTMLElement)!.innerText = new Date().getFullYear().toString();

	// get old log right away
	getLog();

	getSettingsAsync().then(async Settings => {
		_settings = Settings;

		setUiElementState();

		getLastPublicIp();
		await getSelectedDnsEntries();
	})
		.then(() => {
			// refresh log to show DNS entry fetch status
			getLog();
			setupSse();
		});

	getPublicIp();
}

async function getLog(lastId?: number): Promise<void> {
	let pageSize = 10;
	let isAppending = lastId != null;
	let logEntries = await getLogAsync(pageSize, lastId);

	let tableBodyEl = document.getElementById("log-table-body") as HTMLTableSectionElement;

	if (!isAppending)
		tableBodyEl.innerHTML = "";

	logEntries.forEach((entry) => {
		let color: string;
		if (entry.logLevelText == "Error")
			color = "text-danger";
		else if (entry.logLevelText == "Warning")
			color = "text-warning";
		else
			color = "text-body";

		let row = document.createElement('tr');
		row.setAttribute("data-id", entry.id!.toString());
		row.classList.add(color);

		row.insertCell().innerHTML = format(parseISO(entry.created!), "yyyy-MM-dd HH:mm:ss");
		row.insertCell().innerHTML = linkifyHtml(entry.text!);
		row.insertCell().innerHTML = entry.logLevelText!;
		tableBodyEl.appendChild(row);
	});

	document.getElementById("log-clear")!.classList.toggle("d-none", tableBodyEl.rows.length == 0);
	document.getElementById("log-load-more")!.classList.toggle("d-none", logEntries.length != pageSize);
}

document.getElementById('log-clear')!.addEventListener('click', async function (e) {
	e.preventDefault();

	if (!confirm("Are you sure you want to clear the log?"))
		return;

	let msg = await deleteLogAsync();

	if (msg == "ok") {
		let tableBodyEl = document.getElementById("log-table-body") as HTMLTableSectionElement;
		tableBodyEl.innerHTML = "";
		document.getElementById("log-clear")!.classList.add("d-none");
		document.getElementById("log-load-more")!.classList.add("d-none");
	}
	else
		alert(msg);
}, false);

document.getElementById('log-load-more')!.addEventListener('click', function (e) {
	e.preventDefault();

	let lastId = document.querySelector("#log-table-body tr:last-child")?.getAttribute("data-id");
	getLog(parseInt(lastId!));
}, false);

async function getLastPublicIp() {
	if (_settings == null)
		return;

	if (_settings.publicIpv4Address != null && _settings.publicIpv4Address != "")
		(document.getElementById("public-ipv4") as HTMLInputElement)!.innerHTML = _settings.publicIpv4Address!;
	if (_settings.publicIpv6Address != null && _settings.publicIpv6Address != "")
		(document.getElementById("public-ipv6") as HTMLInputElement)!.innerHTML = _settings.publicIpv6Address!;
}

async function getPublicIp() {
	let ip = await getIp();

	if (ip == null)
		return;

	if (ip.ipv4 != null && ip.ipv4 != "")
		(document.getElementById("public-ipv4") as HTMLInputElement)!.value = ip.ipv4!;
	if (ip.ipv6 != null && ip.ipv6 != "")
		(document.getElementById("public-ipv6") as HTMLInputElement)!.value = ip.ipv6!;
}

async function getSelectedDnsEntries() {
	let spinnerEl = document.getElementById("dns-entries-spinner") as HTMLDivElement;
	let tableEl = document.getElementById("dns-entries-table") as HTMLTableElement;

	// show spinner
	spinnerEl.classList.remove("d-none");
	tableEl.classList.add("d-none");

	//TODO: if dnsEntries is null, show error message
	let dnsEntries = await getDnsEntries();
	// console.log('dnsEntries', dnsEntries);
	let tableBodyEl = document.getElementById("dns-entries-body") as HTMLTableSectionElement;
	let customTtl: boolean = false;
	dnsEntries!.forEach((entry, i) => {
		let row = document.createElement('tr');

		let checkbox = document.createElement('input');
		checkbox.type = "checkbox";
		checkbox.name = `dns-entry-update${i}`;
		checkbox.value = "yes";
		checkbox.id = `dns-entry-update${i}`;
		checkbox.classList.add("dns-entry-update");
		checkbox.checked = _settings!.selectedDomains!.some(function (domain) {
			return domain.dnsName == entry.dnsName && domain.type == entry.type && domain.zoneName == entry.zoneName;
		});
		checkbox.setAttribute("data-zone-name", entry.zoneName!);
		checkbox.setAttribute("data-dns-name", entry.dnsName!);
		checkbox.setAttribute("data-dns-type", entry.type!);
		checkbox.addEventListener('change', function (e) {
			e.preventDefault();

			saveDnsUpdatable();
		});
		row.insertCell().appendChild(checkbox);
		row.insertCell().innerHTML = entry.type!;
		row.insertCell().innerHTML = entry.dnsName!;
		row.insertCell().innerHTML = entry.address!;
		let ttlDisplay = entry.ttl! == 1 ? 'Auto' : (entry.ttl! / 60).toString();
		if (ttlDisplay != 'Auto')
			customTtl = true;
		row.insertCell().innerHTML = ttlDisplay;
		row.insertCell().innerHTML = entry.proxied!.toString();
		tableBodyEl.appendChild(row);
	});

	// if all TTLs are auto, hide the units
	if (customTtl)
		(document.getElementById("ttlHeader") as HTMLElement)!.innerText = 'TTL (minutes)';

	// show table
	spinnerEl.classList.add("d-none");
	tableEl.classList.remove("d-none");
}

async function saveDnsUpdatable() {
	let selectedDomainEls = document.querySelectorAll(".dns-entry-update:checked") as NodeListOf<HTMLInputElement>;
	let data: SelectedDomain[] = [];
	selectedDomainEls.forEach((el) => {
		let sd = new SelectedDomain();
		sd.zoneName = el.getAttribute("data-zone-name")!;
		sd.dnsName = el.getAttribute("data-dns-name")!;
		sd.type = el.getAttribute("data-dns-type")!;
		data.push(sd);
	});

	await saveDomainsAsync(data);
}

function setUiElementState() {
	if (_settings?.protocolSupport != 1)
		(document.getElementById("public-ipv4-info") as HTMLDivElement).classList.remove("d-none");
	if (_settings?.protocolSupport != 0)
		(document.getElementById("public-ipv6-info") as HTMLDivElement).classList.remove("d-none");
}

function setupSse() {
	let source = new EventSource('/sse');

	source.addEventListener('log-updated', function (e) {
		getLog();
	}, false);

	source.addEventListener('next-update', function (e) {
		let nextUpdateDate = format(parseISO(e.data), "yyyy-MM-dd HH:mm:ss");
		(document.getElementById("next-update")! as HTMLInputElement).value = nextUpdateDate;
	}, false);

	source.addEventListener('ipv4-address', function (e) {
		(document.getElementById("public-ipv4")! as HTMLInputElement).value = e.data;
	}, false);

	source.addEventListener('ipv6-address', function (e) {
		(document.getElementById("public-ipv6")! as HTMLInputElement).value = e.data;
	}, false);
}
