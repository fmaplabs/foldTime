--- Statusline component: today's tracked time for the current project.
--- Usable from lualine (or any statusline) as two plain functions:
---   { require("foldtime.lualine").get, cond = require("foldtime.lualine").has }

local M = {}

--- Mirrors the CLI's format_duration_ms: "2h 13m" / "25m".
local function fmt(ms)
	local minutes = math.floor(ms / 60000)
	local hours = math.floor(minutes / 60)
	minutes = minutes % 60
	if hours > 0 then
		return ("%dh %02dm"):format(hours, minutes)
	end
	return ("%dm"):format(minutes)
end

function M.get()
	if not require("foldtime").enabled then
		return "󰔛 off"
	end
	local data = require("foldtime.status").get()
	return "󰔛 " .. fmt(data and data.trackedTodayMs or 0)
end

--- Show the segment only when there is something to say: setup ran, the
--- binary exists, and we're in a repo (or tracking is off, worth surfacing).
function M.has()
	local foldtime = require("foldtime")
	if not foldtime.did_setup or not require("foldtime.cli").available() then
		return false
	end
	if not foldtime.enabled then
		return true
	end
	local data = require("foldtime.status").get()
	return data ~= nil and data.project ~= nil
end

return M
